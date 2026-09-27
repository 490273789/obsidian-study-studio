use std::collections::BTreeMap;

use fst::MapBuilder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::{DictionaryEntry, EngineError, MdictArchive, MdictKind, Result};

pub const COMPILED_FORMAT_VERSION: u32 = 2;
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

const FRAME_TARGET_BYTES: usize = 64 * 1_024;
const PACK_FILE_BYTES: usize = 2 * 1_024 * 1_024;
const INDEX_FILE_BYTES: usize = 512 * 1_024;
const MANIFEST_FILE_BYTES: usize = 2_000_000;
const MAX_DUPLICATES: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDescriptor {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDescriptor {
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub codec: FrameCodec,
    pub file: String,
    pub length: u32,
    pub offset: u32,
    pub unpacked_size: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameCodec {
    Deflate,
    None,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDescriptor {
    pub first_key: String,
    pub fst_file: String,
    pub last_key: String,
    pub postings_file: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonIndexDescriptor {
    pub file: String,
    pub first_key: String,
    pub last_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledManifest {
    pub engine_version: String,
    pub entry_count: u64,
    pub files: BTreeMap<String, FileDescriptor>,
    pub format_version: u32,
    pub indexes: Vec<IndexDescriptor>,
    pub record_frames: Vec<FrameDescriptor>,
    pub remote_resource_kind: Option<String>,
    pub resources: Vec<JsonIndexDescriptor>,
    pub script: Option<String>,
    pub sources: Vec<SourceDescriptor>,
    pub stylesheet: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledPackage {
    pub files: BTreeMap<String, Vec<u8>>,
    pub manifest: CompiledManifest,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordValue {
    definition: String,
    key_text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordLocator {
    frame: u32,
    item: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceLocator {
    frames: Vec<FrameDescriptor>,
    mime: String,
}

pub fn compile_archive(
    definitions: &MdictArchive,
    resources: &[MdictArchive],
    stylesheet: Option<&str>,
    script: Option<&str>,
    remote_resource_kind: Option<&str>,
    mut sources: Vec<SourceDescriptor>,
) -> Result<CompiledPackage> {
    let mut compiler = PackageCompiler::new(
        definitions,
        stylesheet,
        script,
        remote_resource_kind,
        std::mem::take(&mut sources),
    )?;
    for archive in resources {
        compiler.add_resources(archive)?;
    }
    compiler.finish()
}

pub(crate) struct PackageCompiler {
    entry_count: u64,
    indexes: Vec<IndexDescriptor>,
    package: PackageWriter,
    record_frames: Vec<FrameDescriptor>,
    remote_resource_kind: Option<String>,
    resource_locators: BTreeMap<String, Vec<ResourceLocator>>,
    resource_writer: FramePackWriter,
    script_path: Option<String>,
    sources: Vec<SourceDescriptor>,
    stylesheet_path: Option<String>,
}

impl PackageCompiler {
    pub(crate) fn new(
        definitions: &MdictArchive,
        stylesheet: Option<&str>,
        script: Option<&str>,
        remote_resource_kind: Option<&str>,
        sources: Vec<SourceDescriptor>,
    ) -> Result<Self> {
        if definitions.kind != MdictKind::Definitions {
            return Err(EngineError::corrupt("dictionary archive kind mismatch"));
        }
        Self::from_entries(
            definitions.entries.iter().cloned().map(Ok),
            stylesheet,
            script,
            remote_resource_kind,
            sources,
        )
    }

    pub(crate) fn from_entries<I>(
        entries: I,
        stylesheet: Option<&str>,
        script: Option<&str>,
        remote_resource_kind: Option<&str>,
        mut sources: Vec<SourceDescriptor>,
    ) -> Result<Self>
    where
        I: IntoIterator<Item = Result<DictionaryEntry>>,
    {
        sources.sort_by(|left, right| left.name.cmp(&right.name));
        let mut package = PackageWriter::default();
        let (entry_count, record_frames, exact) = write_definition_entries(&mut package, entries)?;
        let indexes = write_word_indexes(&mut package, exact)?;
        let stylesheet_path = match stylesheet.filter(|value| !value.is_empty()) {
            Some(value) => {
                package.add("style.css", value.as_bytes().to_vec())?;
                Some("style.css".to_owned())
            }
            None => None,
        };
        let script_path = match script.filter(|value| !value.is_empty()) {
            Some(value) => {
                package.add("script.js", value.as_bytes().to_vec())?;
                Some("script.js".to_owned())
            }
            None => None,
        };
        Ok(Self {
            entry_count,
            indexes,
            package,
            record_frames,
            remote_resource_kind: remote_resource_kind.map(str::to_owned),
            resource_locators: BTreeMap::new(),
            resource_writer: FramePackWriter::new("resources"),
            script_path,
            sources,
            stylesheet_path,
        })
    }

    pub(crate) fn add_resources(&mut self, archive: &MdictArchive) -> Result<()> {
        if archive.kind != MdictKind::Resources {
            return Err(EngineError::corrupt("dictionary archive kind mismatch"));
        }
        for entry in &archive.entries {
            let Some(mime) = resource_mime(&entry.key) else {
                continue;
            };
            let key = normalize_resource_key(&entry.key);
            if self
                .resource_locators
                .get(&key)
                .is_some_and(|values| values.len() >= 8)
            {
                continue;
            }
            let mut frames = Vec::new();
            for chunk in entry.data.chunks(PACK_FILE_BYTES * 9 / 10) {
                frames.push(
                    self.resource_writer
                        .add_embedded_bytes(&mut self.package, chunk)?,
                );
            }
            self.resource_locators
                .entry(key)
                .or_default()
                .push(ResourceLocator {
                    frames,
                    mime: mime.to_owned(),
                });
        }
        self.resource_writer.flush(&mut self.package)
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub(crate) fn entry_count(&self) -> u64 {
        self.entry_count
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub(crate) fn file_count(&self) -> usize {
        self.package.files.len()
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub(crate) fn file_path(&self, index: usize) -> Option<String> {
        self.package.files.keys().nth(index).cloned()
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub(crate) fn take_file(&mut self, index: usize) -> Option<Vec<u8>> {
        let path = self.file_path(index)?;
        self.package.files.remove(&path)
    }

    pub(crate) fn finish(mut self) -> Result<CompiledPackage> {
        self.resource_writer.finish(&mut self.package)?;
        let resource_indexes =
            write_json_map_chunks(&mut self.package, "resources", self.resource_locators)?;
        let manifest = CompiledManifest {
            engine_version: ENGINE_VERSION.to_owned(),
            entry_count: self.entry_count,
            files: self.package.descriptors(),
            format_version: COMPILED_FORMAT_VERSION,
            indexes: self.indexes,
            record_frames: self.record_frames,
            remote_resource_kind: self.remote_resource_kind,
            resources: resource_indexes,
            script: self.script_path,
            sources: self.sources,
            stylesheet: self.stylesheet_path,
        };
        let manifest_bytes = deterministic_json(&manifest)?;
        if manifest_bytes.len() > MANIFEST_FILE_BYTES {
            return Err(EngineError::limit("compiled manifest is too large"));
        }
        self.package.add("manifest.json", manifest_bytes)?;
        Ok(CompiledPackage {
            files: self.package.files,
            manifest,
        })
    }
}

#[derive(Default)]
struct PackageWriter {
    descriptors: BTreeMap<String, FileDescriptor>,
    files: BTreeMap<String, Vec<u8>>,
}

type DefinitionEntries = (
    u64,
    Vec<FrameDescriptor>,
    BTreeMap<String, Vec<RecordLocator>>,
);

impl PackageWriter {
    fn add(&mut self, path: &str, data: Vec<u8>) -> Result<()> {
        if !valid_package_path(path) || self.descriptors.contains_key(path) {
            return Err(EngineError::corrupt("invalid duplicate package path"));
        }
        self.descriptors.insert(
            path.to_owned(),
            FileDescriptor {
                sha256: hex_digest(&data),
                size: data.len() as u64,
            },
        );
        self.files.insert(path.to_owned(), data);
        Ok(())
    }

    fn descriptors(&self) -> BTreeMap<String, FileDescriptor> {
        self.descriptors.clone()
    }
}

fn write_definition_entries<I>(package: &mut PackageWriter, entries: I) -> Result<DefinitionEntries>
where
    I: IntoIterator<Item = Result<DictionaryEntry>>,
{
    let mut writer = FramePackWriter::new("records");
    let mut exact = BTreeMap::<String, Vec<RecordLocator>>::new();
    let mut frame = Vec::<String>::new();
    let mut raw = vec![b'['];
    let mut estimated = 2_usize;
    let mut entry_count = 0_u64;
    for entry in entries {
        let entry = entry?;
        let value = RecordValue {
            definition: String::from_utf8(entry.data)
                .map_err(|_| EngineError::corrupt("definition is not UTF-8"))?,
            key_text: entry.key,
        };
        let encoded = deterministic_json(&value)?;
        // Preserve the existing delimiter estimate across frame boundaries so
        // compiled-v2 frames, offsets and checksums remain byte-identical.
        let bytes = encoded.len() + usize::from(!frame.is_empty());
        if !frame.is_empty() && estimated + bytes > FRAME_TARGET_BYTES {
            flush_definition_frame(package, &mut writer, &mut frame, &mut raw, &mut exact)?;
            estimated = 2;
        }
        estimated += bytes;
        if !frame.is_empty() {
            raw.push(b',');
        }
        raw.extend_from_slice(&encoded);
        frame.push(value.key_text);
        entry_count = entry_count
            .checked_add(1)
            .ok_or_else(|| EngineError::limit("too many dictionary entries"))?;
    }
    if !frame.is_empty() {
        flush_definition_frame(package, &mut writer, &mut frame, &mut raw, &mut exact)?;
    }
    let frames = writer.finish(package)?;
    Ok((entry_count, frames, exact))
}

fn flush_definition_frame(
    package: &mut PackageWriter,
    writer: &mut FramePackWriter,
    frame: &mut Vec<String>,
    raw: &mut Vec<u8>,
    exact: &mut BTreeMap<String, Vec<RecordLocator>>,
) -> Result<()> {
    raw.push(b']');
    let frame_index = writer.add_bytes(package, raw)?;
    for (item, entry) in frame.iter().enumerate() {
        let key = normalize_lookup_key(entry);
        if key.is_empty() {
            continue;
        }
        let values = exact.entry(key).or_default();
        if values.len() >= MAX_DUPLICATES {
            continue;
        }
        values.push(RecordLocator {
            frame: frame_index,
            item: u16::try_from(item).map_err(|_| EngineError::limit("too many frame items"))?,
        });
    }
    frame.clear();
    if raw.capacity() > FRAME_TARGET_BYTES * 2 {
        // A single large definition may exceed the normal frame target. Do not
        // retain its encoded allocation for the rest of the dictionary import.
        *raw = vec![b'['];
    } else {
        raw.clear();
        raw.push(b'[');
    }
    Ok(())
}

fn write_word_indexes(
    package: &mut PackageWriter,
    exact: BTreeMap<String, Vec<RecordLocator>>,
) -> Result<Vec<IndexDescriptor>> {
    let mut chunks = Vec::<Vec<(String, Vec<RecordLocator>)>>::new();
    let mut chunk = Vec::new();
    let mut estimated = 0_usize;
    for item in exact {
        let item_size = item.0.len() + deterministic_json(&item.1)?.len() + 32;
        if !chunk.is_empty() && estimated + item_size > INDEX_FILE_BYTES * 3 / 4 {
            chunks.push(std::mem::take(&mut chunk));
            estimated = 0;
        }
        estimated += item_size;
        chunk.push(item);
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    let mut result = Vec::with_capacity(chunks.len());
    for (index, chunk) in chunks.into_iter().enumerate() {
        let fst_path = format!("indexes/exact-{index:06}.fst");
        let postings_path = format!("indexes/postings-{index:06}.json");
        let mut fst = Vec::new();
        {
            let mut builder = MapBuilder::new(&mut fst)
                .map_err(|_| EngineError::corrupt("cannot create FST index"))?;
            for (value, (key, _)) in chunk.iter().enumerate() {
                builder
                    .insert(key, value as u64)
                    .map_err(|_| EngineError::corrupt("cannot write FST index"))?;
            }
            builder
                .finish()
                .map_err(|_| EngineError::corrupt("cannot finish FST index"))?;
        }
        let postings =
            deterministic_json(&chunk.iter().map(|(_, values)| values).collect::<Vec<_>>())?;
        if fst.len() > INDEX_FILE_BYTES || postings.len() > INDEX_FILE_BYTES {
            return Err(EngineError::limit("compiled index shard is too large"));
        }
        let first_key = chunk.first().expect("non-empty chunk").0.clone();
        let last_key = chunk.last().expect("non-empty chunk").0.clone();
        package.add(&fst_path, fst)?;
        package.add(&postings_path, postings)?;
        result.push(IndexDescriptor {
            first_key,
            fst_file: fst_path,
            last_key,
            postings_file: postings_path,
        });
    }
    Ok(result)
}

fn write_json_map_chunks<T: Serialize>(
    package: &mut PackageWriter,
    name: &str,
    values: BTreeMap<String, T>,
) -> Result<Vec<JsonIndexDescriptor>> {
    let mut chunks = Vec::<BTreeMap<String, T>>::new();
    let mut chunk = BTreeMap::new();
    let mut estimated = 2_usize;
    for (key, value) in values {
        let bytes = key.len() + deterministic_json(&value)?.len() + 8;
        if !chunk.is_empty() && estimated + bytes > INDEX_FILE_BYTES * 3 / 4 {
            chunks.push(std::mem::take(&mut chunk));
            estimated = 2;
        }
        estimated += bytes;
        chunk.insert(key, value);
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    let mut result = Vec::new();
    for (index, chunk) in chunks.into_iter().enumerate() {
        let bytes = deterministic_json(&chunk)?;
        if bytes.len() > INDEX_FILE_BYTES {
            return Err(EngineError::limit("compiled JSON index shard is too large"));
        }
        let file = format!("indexes/{name}-{index:06}.json");
        let first_key = chunk.first_key_value().expect("non-empty chunk").0.clone();
        let last_key = chunk.last_key_value().expect("non-empty chunk").0.clone();
        package.add(&file, bytes)?;
        result.push(JsonIndexDescriptor {
            file,
            first_key,
            last_key,
        });
    }
    Ok(result)
}

struct FramePackWriter {
    frames: Vec<FrameDescriptor>,
    name: &'static str,
    pack: Vec<u8>,
    pack_index: u32,
}

impl FramePackWriter {
    fn new(name: &'static str) -> Self {
        Self {
            frames: Vec::new(),
            name,
            pack: Vec::new(),
            pack_index: 0,
        }
    }

    fn add_bytes(&mut self, package: &mut PackageWriter, raw: &[u8]) -> Result<u32> {
        let compressed = miniz_oxide::deflate::compress_to_vec_zlib(raw, 3);
        let (codec, data) = if compressed.len() * 100 <= raw.len() * 95 {
            (FrameCodec::Deflate, compressed)
        } else {
            (FrameCodec::None, raw.to_vec())
        };
        if data.len() > PACK_FILE_BYTES {
            return Err(EngineError::limit("compiled frame is too large"));
        }
        if !self.pack.is_empty() && self.pack.len() + data.len() > PACK_FILE_BYTES {
            self.flush(package)?;
        }
        let file = format!("blocks/{}-{:06}.bin", self.name, self.pack_index);
        let frame_index = self.frames.len() as u32;
        let offset = self.pack.len() as u32;
        let length = data.len() as u32;
        self.pack.extend_from_slice(&data);
        self.frames.push(FrameDescriptor {
            codec,
            file,
            length,
            offset,
            unpacked_size: raw
                .len()
                .try_into()
                .map_err(|_| EngineError::limit("compiled frame is too large"))?,
        });
        Ok(frame_index)
    }

    fn add_embedded_bytes(
        &mut self,
        package: &mut PackageWriter,
        raw: &[u8],
    ) -> Result<FrameDescriptor> {
        self.add_bytes(package, raw)?;
        self.frames
            .pop()
            .ok_or_else(|| EngineError::corrupt("compiled resource frame is missing"))
    }

    fn finish(mut self, package: &mut PackageWriter) -> Result<Vec<FrameDescriptor>> {
        self.flush(package)?;
        Ok(self.frames)
    }

    fn flush(&mut self, package: &mut PackageWriter) -> Result<()> {
        if self.pack.is_empty() {
            return Ok(());
        }
        let file = format!("blocks/{}-{:06}.bin", self.name, self.pack_index);
        package.add(&file, std::mem::take(&mut self.pack))?;
        self.pack_index += 1;
        Ok(())
    }
}

fn normalize_lookup_key(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| {
            !matches!(
                character,
                '(' | ')'
                    | '.'
                    | ','
                    | '-'
                    | '&'
                    | '、'
                    | ' '
                    | '\''
                    | '/'
                    | '\\'
                    | '@'
                    | '_'
                    | '$'
                    | '!'
            )
        })
        .collect::<String>()
        .trim()
        .to_owned()
}

fn normalize_resource_key(value: &str) -> String {
    value
        .replace('\\', "/")
        .trim_start_matches('/')
        .nfkc()
        .flat_map(char::to_lowercase)
        .collect()
}

fn resource_mime(path: &str) -> Option<&'static str> {
    let extension = path.rsplit('.').next()?.to_ascii_lowercase();
    match extension.as_str() {
        "aac" => Some("audio/aac"),
        "apng" => Some("image/apng"),
        "avif" => Some("image/avif"),
        "bin" | "dat" => Some("application/octet-stream"),
        "bmp" => Some("image/bmp"),
        "css" => Some("text/css"),
        "eot" => Some("application/vnd.ms-fontobject"),
        "flac" => Some("audio/flac"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "html" | "htm" => Some("text/html"),
        "jpeg" | "jpg" => Some("image/jpeg"),
        "json" => Some("application/json"),
        "m4a" => Some("audio/mp4"),
        "m4v" => Some("video/mp4"),
        "map" => Some("application/json"),
        "md" => Some("text/plain"),
        "mov" => Some("video/quicktime"),
        "mp3" => Some("audio/mpeg"),
        "mp4" => Some("video/mp4"),
        "ogg" | "oga" => Some("audio/ogg"),
        "ogv" => Some("video/ogg"),
        "opus" => Some("audio/opus"),
        "otf" => Some("font/otf"),
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "js" => Some("text/javascript"),
        "ttf" => Some("font/ttf"),
        "txt" => Some("text/plain"),
        "vtt" => Some("text/vtt"),
        "wasm" => Some("application/wasm"),
        "wav" => Some("audio/wav"),
        "weba" => Some("audio/webm"),
        "webm" => Some("audio/webm"),
        "webmanifest" => Some("application/manifest+json"),
        "webp" => Some("image/webp"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "xml" => Some("application/xml"),
        _ => None,
    }
}

fn deterministic_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|_| EngineError::corrupt("cannot encode compiled package"))
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_package_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains("..")
        && path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(entries: &[(&str, &str)]) -> MdictArchive {
        MdictArchive {
            entries: entries
                .iter()
                .map(|(key, definition)| DictionaryEntry {
                    data: definition.as_bytes().to_vec(),
                    key: (*key).to_owned(),
                })
                .collect(),
            kind: MdictKind::Definitions,
            stylesheet: BTreeMap::new(),
        }
    }

    fn resources(entries: &[(&str, &[u8])]) -> MdictArchive {
        MdictArchive {
            entries: entries
                .iter()
                .map(|(key, data)| DictionaryEntry {
                    data: data.to_vec(),
                    key: (*key).to_owned(),
                })
                .collect(),
            kind: MdictKind::Resources,
            stylesheet: BTreeMap::new(),
        }
    }

    #[test]
    fn build_is_deterministic_and_caps_duplicates() {
        let mut entries = Vec::new();
        for index in 0..80 {
            entries.push(("Test", format!("definition {index}")));
        }
        let input = MdictArchive {
            entries: entries
                .iter()
                .map(|(key, definition)| DictionaryEntry {
                    data: definition.as_bytes().to_vec(),
                    key: (*key).to_owned(),
                })
                .collect(),
            kind: MdictKind::Definitions,
            stylesheet: BTreeMap::new(),
        };
        let first = compile_archive(&input, &[], None, None, None, vec![]).expect("build package");
        let second = compile_archive(&input, &[], None, None, None, vec![]).expect("build package");
        assert_eq!(first.files, second.files);
        assert_eq!(first.manifest, second.manifest);
        let postings = first
            .files
            .get("indexes/postings-000000.json")
            .expect("postings");
        let values: Vec<Vec<RecordLocator>> = serde_json::from_slice(postings).expect("JSON");
        assert_eq!(values[0].len(), MAX_DUPLICATES);
    }

    #[test]
    fn package_uses_balanced_frame_and_pack_limits() {
        let input = archive(&[("alpha", "one"), ("alphabet", "two"), ("beta", "three")]);
        let package = compile_archive(
            &input,
            &[],
            Some(".x { color: red; }"),
            Some("document.body.dataset.ready = 'true'"),
            None,
            vec![],
        )
        .expect("build package");
        assert_eq!(package.manifest.format_version, 2);
        assert!(package
            .files
            .values()
            .all(|value| value.len() <= PACK_FILE_BYTES));
        assert!(package.files.contains_key("style.css"));
        assert!(package.files.contains_key("script.js"));
        assert_eq!(package.manifest.script.as_deref(), Some("script.js"));
        assert_eq!(resource_mime("images/icon.svg"), Some("image/svg+xml"));
        assert_eq!(resource_mime("images/photo.avif"), Some("image/avif"));
        assert_eq!(resource_mime("audio/example.m4a"), Some("audio/mp4"));
        assert_eq!(resource_mime("video/example.mp4"), Some("video/mp4"));
        assert_eq!(resource_mime("data/options.json"), Some("application/json"));
        assert_eq!(
            resource_mime("runtime/parser.wasm"),
            Some("application/wasm")
        );
        assert_eq!(resource_mime("css/config.css"), Some("text/css"));
        assert_eq!(
            resource_mime("scripts/dictionary-runtime.js"),
            Some("text/javascript")
        );
    }

    #[test]
    fn incremental_resource_compilation_can_drain_files_without_changing_output() {
        let definitions = archive(&[("alpha", "one"), ("beta", "two")]);
        let first_resources = resources(&[("images/a.png", &[1, 2, 3])]);
        let second_resources = resources(&[("audio/b.mp3", &[4, 5, 6])]);
        let expected = compile_archive(
            &definitions,
            &[first_resources.clone(), second_resources.clone()],
            None,
            None,
            None,
            vec![],
        )
        .expect("complete package");

        let mut compiler = PackageCompiler::new(&definitions, None, None, None, vec![])
            .expect("compile definitions");
        assert_eq!(compiler.entry_count(), 2);
        let mut drained = BTreeMap::new();
        while compiler.file_count() > 0 {
            let path = compiler.file_path(0).expect("package path");
            let bytes = compiler.take_file(0).expect("package bytes");
            drained.insert(path, bytes);
        }
        compiler
            .add_resources(&first_resources)
            .expect("first resources");
        while compiler.file_count() > 0 {
            let path = compiler.file_path(0).expect("package path");
            let bytes = compiler.take_file(0).expect("package bytes");
            drained.insert(path, bytes);
        }
        compiler
            .add_resources(&second_resources)
            .expect("second resources");
        while compiler.file_count() > 0 {
            let path = compiler.file_path(0).expect("package path");
            let bytes = compiler.take_file(0).expect("package bytes");
            drained.insert(path, bytes);
        }
        let completed = compiler.finish().expect("finish package");
        drained.extend(completed.files);

        assert_eq!(drained, expected.files);
        assert_eq!(completed.manifest, expected.manifest);
    }

    #[test]
    fn large_resource_catalog_keeps_the_runtime_manifest_bounded() {
        let definitions = archive(&[("purpose", "definition")]);
        let resource_entries = (0..25_000)
            .map(|index| DictionaryEntry {
                data: vec![index as u8],
                key: format!("images/{index:05}.png"),
            })
            .collect();
        let resource_archive = MdictArchive {
            entries: resource_entries,
            kind: MdictKind::Resources,
            stylesheet: BTreeMap::new(),
        };

        let package = compile_archive(&definitions, &[resource_archive], None, None, None, vec![])
            .expect("compile resource-heavy dictionary");
        let manifest = package.files.get("manifest.json").expect("manifest");
        let manifest_json: serde_json::Value = serde_json::from_slice(manifest).expect("JSON");

        assert!(
            manifest.len() <= MANIFEST_FILE_BYTES,
            "manifest is {} bytes",
            manifest.len()
        );
        assert!(manifest_json.get("resourceFrames").is_none());
        assert!(package
            .manifest
            .resources
            .iter()
            .all(|index| package.files[&index.file].len() <= INDEX_FILE_BYTES));
    }
}

#[cfg(test)]
#[path = "package_serialization_tests.rs"]
mod serialization_tests;
