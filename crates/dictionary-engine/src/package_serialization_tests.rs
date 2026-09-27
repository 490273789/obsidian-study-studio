// The pre-optimization writer is a compatibility oracle for compiled-v2 bytes.
use super::*;

fn compare(entries: Vec<DictionaryEntry>) {
    let mut old = PackageWriter::default();
    let mut new = PackageWriter::default();
    let expected =
        reference_write_definition_entries(&mut old, entries.clone().into_iter().map(Ok))
            .expect("reference package");
    let actual =
        write_definition_entries(&mut new, entries.into_iter().map(Ok)).expect("optimized package");
    assert_eq!(actual, expected);
    let old_indexes = write_word_indexes(&mut old, expected.2).unwrap();
    let new_indexes = write_word_indexes(&mut new, actual.2).unwrap();
    assert_eq!(new_indexes, old_indexes);
    assert_eq!(new.files, old.files);
    assert_eq!(new.descriptors, old.descriptors);
}

#[test]
fn serialized_records_preserve_empty_unicode_escapes_and_duplicate_limits() {
    compare(vec![]);
    let keys = ["", " ", "中文", "e\u{301}", "é", "\"\\\n", "same"];
    compare(
        (0..400)
            .map(|index| DictionaryEntry {
                key: keys[index % keys.len()].to_owned(),
                data: format!("<p>中文 café {index}\0\u{001f}\n\r\t\\\"</p>").into_bytes(),
            })
            .collect(),
    );
    compare(
        (0..100)
            .map(|index| DictionaryEntry {
                key: "same".to_owned(),
                data: format!("definition {index}").into_bytes(),
            })
            .collect(),
    );
}

#[test]
fn serialized_records_preserve_frame_boundaries_and_oversized_entries() {
    for target in [
        FRAME_TARGET_BYTES - 1,
        FRAME_TARGET_BYTES,
        FRAME_TARGET_BYTES + 1,
        1_048_576,
    ] {
        let key = "boundary";
        let overhead = deterministic_json(&vec![RecordValue {
            definition: String::new(),
            key_text: key.to_owned(),
        }])
        .unwrap()
        .len();
        let large = DictionaryEntry {
            key: key.to_owned(),
            data: vec![b'x'; target - overhead],
        };
        let small = DictionaryEntry {
            key: "tail".to_owned(),
            data: b"definition".to_vec(),
        };
        compare(vec![large.clone()]);
        compare(vec![
            small.clone(),
            large.clone(),
            small.clone(),
            large,
            small,
        ]);
    }
}

#[test]
fn oversized_frame_does_not_retain_its_allocation_after_flush() {
    let mut raw = deterministic_json(&vec![RecordValue {
        definition: "x".repeat(FRAME_TARGET_BYTES * 8),
        key_text: "large".to_owned(),
    }])
    .unwrap();
    raw.pop(); // flush_definition_frame owns the closing array delimiter.
    let mut keys = vec!["large".to_owned()];
    let mut package = PackageWriter::default();
    let mut writer = FramePackWriter::new("records");
    let mut exact = BTreeMap::new();
    flush_definition_frame(&mut package, &mut writer, &mut keys, &mut raw, &mut exact).unwrap();
    assert_eq!(raw, b"[");
    assert!(raw.capacity() <= FRAME_TARGET_BYTES * 2);
    assert!(keys.is_empty());
}

fn reference_write_definition_entries<I>(
    package: &mut PackageWriter,
    entries: I,
) -> Result<DefinitionEntries>
where
    I: IntoIterator<Item = Result<DictionaryEntry>>,
{
    let mut writer = FramePackWriter::new("records");
    let mut exact = BTreeMap::<String, Vec<RecordLocator>>::new();
    let mut frame = Vec::<RecordValue>::new();
    let mut estimated = 2_usize;
    let mut entry_count = 0_u64;
    for entry in entries {
        let entry = entry?;
        let value = RecordValue {
            definition: String::from_utf8(entry.data)
                .map_err(|_| EngineError::corrupt("definition is not UTF-8"))?,
            key_text: entry.key,
        };
        let bytes = deterministic_json(&value)?.len() + usize::from(!frame.is_empty());
        if !frame.is_empty() && estimated + bytes > FRAME_TARGET_BYTES {
            reference_flush_definition_frame(package, &mut writer, &mut frame, &mut exact)?;
            estimated = 2;
        }
        estimated += bytes;
        frame.push(value);
        entry_count = entry_count
            .checked_add(1)
            .ok_or_else(|| EngineError::limit("too many dictionary entries"))?;
    }
    if !frame.is_empty() {
        reference_flush_definition_frame(package, &mut writer, &mut frame, &mut exact)?;
    }
    let frames = writer.finish(package)?;
    Ok((entry_count, frames, exact))
}

fn reference_flush_definition_frame(
    package: &mut PackageWriter,
    writer: &mut FramePackWriter,
    frame: &mut Vec<RecordValue>,
    exact: &mut BTreeMap<String, Vec<RecordLocator>>,
) -> Result<()> {
    let raw = deterministic_json(frame)?;
    let frame_index = writer.add_bytes(package, &raw)?;
    for (item, entry) in frame.iter().enumerate() {
        let key = normalize_lookup_key(&entry.key_text);
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
    Ok(())
}
