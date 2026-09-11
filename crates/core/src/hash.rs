//! FNV-1a 64-bit — the pinned Calyx hash (ABI §6a / §7).
//!
//! Constants are pinned by the ABI and reproduced by both runtimes.
//! `run_hash` folds each frame's hash as 8 little-endian bytes; everything
//! renders as 16 lowercase hex chars.

pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV_PRIME: u64 = 0x100000001b3;

/// Streaming FNV-1a-64 accumulator.
#[derive(Clone, Copy, Debug)]
pub struct Fnv(u64);

impl Fnv {
    pub fn new() -> Self {
        Fnv(FNV_OFFSET)
    }
    pub fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 ^= b as u64;
            self.0 = self.0.wrapping_mul(FNV_PRIME);
        }
    }
    pub fn finish(&self) -> u64 {
        self.0
    }
}

impl Default for Fnv {
    fn default() -> Self {
        Self::new()
    }
}

/// One-shot FNV-1a-64 over a byte slice.
pub fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut h = Fnv::new();
    h.write(bytes);
    h.finish()
}

/// The canonical 16-lowercase-hex rendering used across the ABI.
pub fn hex16(v: u64) -> String {
    format!("{v:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_offset_basis() {
        assert_eq!(hash_bytes(b""), FNV_OFFSET);
    }

    #[test]
    fn matches_canonical_vectors() {
        // Standard FNV-1a-64 test vectors — pin that the constants and
        // byte order match the reference algorithm every runtime uses.
        assert_eq!(hash_bytes(b"a"), 0xaf63dc4c8601ec8c);
        assert_eq!(hash_bytes(b"foobar"), 0x85944171f73967e8);
    }

    #[test]
    fn streaming_equals_oneshot() {
        let mut h = Fnv::new();
        h.write(b"foo");
        h.write(b"bar");
        assert_eq!(h.finish(), hash_bytes(b"foobar"));
    }

    #[test]
    fn order_sensitive() {
        assert_ne!(hash_bytes(b"ab"), hash_bytes(b"ba"));
    }

    #[test]
    fn hex_is_16_chars() {
        assert_eq!(hex16(FNV_OFFSET), "cbf29ce484222325");
        assert_eq!(hex16(0).len(), 16);
    }
}
