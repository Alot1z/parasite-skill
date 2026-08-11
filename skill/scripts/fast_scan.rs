// fast_scan.rs — skill-router fast inventory scanner.
// A tiny Rust twin of the scan pass, useful when the skill tree outgrows the
// JS/Python engines (10k+ SKILL.md files). Pattern borrowed from the Rust CLI
// tools in the starred-repo research: zero deps, walkdir via std, one pass.
//
// Build:  rustc -O fast_scan.rs -o fast_scan
// Usage:  ./fast_scan <root-dir>          # print name<TAB>path per skill dir
//
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn main() -> io::Result<()> {
    let root = env::args().nth(1).unwrap_or_else(|| ".".to_string());
    let root_path = PathBuf::from(&root);
    let mut count = 0usize;
    walk(&root_path, &mut count)?;
    eprintln!("scanned {} skill dirs", count);
    Ok(())
}

fn walk(dir: &Path, count: &mut usize) -> io::Result<()> {
    let mut entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()), // skip unreadable dirs
    };
    let mut skills: Vec<PathBuf> = Vec::new();
    while let Some(Ok(e)) = entries.next() {
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        // A skill dir contains SKILL.md; recurse into everything else.
        if path.join("SKILL.md").is_file() {
            skills.push(path);
        } else {
            walk(&path, count)?;
        }
    }
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for s in skills {
        let name = s
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        writeln!(out, "{}\t{}", name, s.display())?;
        *count += 1;
    }
    Ok(())
}
