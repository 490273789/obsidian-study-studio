"""Compare separately built package-benchmark binaries, without timing builds.

python3 scripts/measure-dictionary-serialization.py BASELINE CANDIDATE OUTPUT_DIRECTORY
The output directory must not exist. On macOS also records process peak RSS.
"""

import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys


def run(binary, count, size, mode, dump=None):
    command = [str(binary), str(count), str(size), "7" if dump is None else "1", mode]
    if dump is not None:
        command.append(str(dump))
    if sys.platform == "darwin":
        command = ["/usr/bin/time", "-l", *command]
    process = subprocess.run(command, capture_output=True, text=True, check=True)
    result = json.loads(process.stdout)
    result["peakRssBytes"] = None
    if sys.platform == "darwin":
        result["peakRssBytes"] = int(next(
            line.split()[0] for line in process.stderr.splitlines()
            if "maximum resident set size" in line
        ))
    return result


def main():
    baseline, candidate, output = (Path(arg).resolve() for arg in sys.argv[1:])
    output.mkdir()
    binaries = {"baseline": baseline, "candidate": candidate}
    results = []
    summary = []
    for count, size, mode in [
        (10_000, 1024, "html"), (100_000, 1024, "html"),
        (500_000, 256, "html"), (40_000, 4096, "html"),
        (30_000, 1024, "varied"), (100_000, 1024, "duplicates"),
    ]:
        scenario = []
        for round_number, order in enumerate([
            ["baseline", "candidate"], ["candidate", "baseline"],
        ]):
            for variant in order:
                result = run(binaries[variant], count, size, mode)
                result.update(variant=variant, round=round_number)
                scenario.append(result)
                results.append(result)
                (output / "samples.json").write_text(json.dumps(results, indent=2) + "\n")
                print(f"{mode} {count} {size} {variant}: {result['medianMs']:.2f} ms", flush=True)
        for field in ["packageSha256", "outputBytes", "recordFrames", "inputBytes"]:
            assert len({item[field] for item in scenario}) == 1, (mode, count, field)
        medians = {
            variant: statistics.median([
                sample for item in scenario if item["variant"] == variant
                for sample in item["samplesMs"]
            ]) for variant in binaries
        }
        summary.append({
            "mode": mode, "entries": count, "definitionTargetBytes": size,
            "baselineMs": medians["baseline"], "candidateMs": medians["candidate"],
            "reductionPercent": 100 * (1 - medians["candidate"] / medians["baseline"]),
        })
    for variant, binary in binaries.items():
        run(binary, 100, 0, "edges", output / variant)
    files = lambda directory: {
        path.relative_to(directory): path.read_bytes()
        for path in directory.rglob("*") if path.is_file()
    }
    assert files(output / "baseline") == files(output / "candidate"), "boundary output differs"
    evidence = {
        "binarySha256": {key: hashlib.sha256(path.read_bytes()).hexdigest()
                         for key, path in binaries.items()},
        "summary": summary, "boundaryFilesByteIdentical": True,
    }
    (output / "summary.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2), flush=True)


if __name__ == "__main__":
    main()
