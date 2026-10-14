//! Release gate using the same signature verifier as Tauri's updater.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use std::io::Read;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        return Err("Usage: verify_update <tauri.conf.json> <archive> <archive.sig>".into());
    }
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let encoded = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing updater public key")?;
    let decode = |value: &str| -> Result<String, Box<dyn std::error::Error>> {
        Ok(String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(value.trim())?,
        )?)
    };
    let key = PublicKey::decode(&decode(encoded)?)?;
    let signature = Signature::decode(&decode(&std::fs::read_to_string(&args[3])?)?)?;
    let mut verifier = key.verify_stream(&signature)?;
    let mut file = std::fs::File::open(&args[2])?;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let size = file.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        verifier.update(&buffer[..size]);
    }
    verifier.finalize()?;
    println!("Update signature matches Aven's configured public key.");
    Ok(())
}
