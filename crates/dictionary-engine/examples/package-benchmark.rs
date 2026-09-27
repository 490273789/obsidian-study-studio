//! Reproducible native package-compilation benchmark (no source parsing or I/O).
//! cargo run --release -p dictionary-engine --example package-benchmark -- 100000 1024 7
use std::{collections::BTreeMap, hint::black_box, time::Instant};

use dictionary_engine::{compile_archive, DictionaryEntry, MdictArchive, MdictKind};
use sha2::{Digest, Sha256};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let count: usize = args.get(1).map(|s| s.parse().unwrap()).unwrap_or(100_000);
    let definition_bytes: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(1_024);
    let repeats: usize = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(7);
    let mode = args.get(4).map(String::as_str).unwrap_or("html");
    assert!(matches!(mode, "html" | "varied" | "duplicates" | "edges"));
    assert!(count > 0 && repeats > 0);
    // Mixed HTML, Unicode and JSON escapes; different text for each entry.
    let text = "<div class=\"entry\">中文释义 café \\ usage\nexample\t</div>";
    let body = text.repeat(definition_bytes.div_ceil(text.len()));
    let archive = MdictArchive {
        entries: (0..count)
            .map(|index| {
                if mode == "edges" {
                    edge_entry(index)
                } else {
                    DictionaryEntry {
                        key: format!(
                            "word-{:08}",
                            if mode == "duplicates" {
                                index % 100
                            } else {
                                index
                            }
                        ),
                        data: if mode == "varied" {
                            varied_definition(index, definition_bytes)
                        } else {
                            format!("{index}: {body}").into_bytes()
                        },
                    }
                }
            })
            .collect(),
        kind: MdictKind::Definitions,
        stylesheet: BTreeMap::new(),
    };
    let input_bytes: usize = archive
        .entries
        .iter()
        .map(|e| e.key.len() + e.data.len())
        .sum();
    let mut samples = Vec::new();
    let mut expected_digest = None;
    let mut output_bytes = 0;
    let mut frame_count = 0;
    // Two warmups. Fixture generation, output hashing and drops are outside timing.
    for iteration in 0..repeats + 2 {
        let start = Instant::now();
        let package = black_box(
            compile_archive(black_box(&archive), &[], None, None, None, vec![])
                .expect("compile package"),
        );
        let elapsed = start.elapsed().as_secs_f64() * 1_000.0;
        if iteration >= 2 {
            samples.push(elapsed);
        }
        if iteration == 0 {
            if let Some(directory) = args.get(5) {
                for (path, data) in &package.files {
                    let path = std::path::Path::new(directory).join(path);
                    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                    std::fs::write(path, data).unwrap();
                }
            }
        }
        let mut digest = Sha256::new();
        for (path, data) in &package.files {
            digest.update((path.len() as u64).to_le_bytes());
            digest.update(path.as_bytes());
            digest.update((data.len() as u64).to_le_bytes());
            digest.update(data);
        }
        let digest = format!("{:x}", digest.finalize());
        if let Some(expected) = &expected_digest {
            assert_eq!(expected, &digest);
        }
        expected_digest = Some(digest);
        output_bytes = package.files.values().map(Vec::len).sum::<usize>();
        frame_count = package.manifest.record_frames.len();
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({
            "mode":mode, "entries":count, "inputBytes":input_bytes, "definitionTargetBytes":definition_bytes,
            "medianMs":samples[samples.len()/2], "samplesMs":samples,
            "outputBytes":output_bytes, "recordFrames":frame_count,
            "packageSha256":expected_digest.unwrap(),
            "scope":"native package compilation; excludes fixture generation, MDX/MDD/EUDIC parsing, worker transfer and disk I/O"
        })
    );
}

// Deterministic lower-compressibility text to avoid relying on repeated HTML.
fn varied_definition(index: usize, target: usize) -> Vec<u8> {
    let mut value = format!("<div class=\"entry\">中文 café {index}\n").into_bytes();
    let mut state = index as u64 + 1;
    while value.len() < target {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        value.extend_from_slice(format!("{:08x} ", (state >> 32) as u32).as_bytes());
    }
    value.extend_from_slice(b"</div>");
    value
}

// Regression corpus for manual byte-for-byte comparison between binaries.
fn edge_entry(index: usize) -> DictionaryEntry {
    let key = match index {
        0 => String::new(),
        1 => "  ".to_owned(),
        2 => "中文 e\u{301} \"\\\n".to_owned(),
        _ => "duplicate".to_owned(),
    };
    let data = if (3..7).contains(&index) {
        // Target the standalone JSON array lengths immediately around 64 KiB,
        // plus a single oversized record. Keep delimiters/field names exact.
        let target = [65_535, 65_536, 65_537, 1_048_576][index - 3];
        let empty = serde_json::json!([{ "definition": "", "keyText": key }]);
        vec![b'x'; target - serde_json::to_vec(&empty).unwrap().len()]
    } else {
        "中文\0\u{001f}\r\n\t\\\" café".as_bytes().to_vec()
    };
    DictionaryEntry { key, data }
}
