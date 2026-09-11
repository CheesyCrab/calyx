//! Input — the Classic face plus the extended digital buttons (ABI §4, §6a).
//!
//! Buttons are named everywhere they cross a boundary (`UP DOWN LEFT RIGHT
//! A B START X Y L R`), never a raw bitmask. The host reports *held* level only;
//! edge detection is the cart's job (done in Sunny), so there is no
//! per-cart state here.

/// Button names by bit, LSB first (ABI §4 Input).
pub const BUTTONS: [&str; 11] = [
    "UP", "DOWN", "LEFT", "RIGHT", "A", "B", "START", "X", "Y", "L", "R",
];

/// Last meaningful presenter input used by privileged system UI (ABI v1.2).
/// This is explicit input context, so headless feeds can script it and launcher
/// rendering remains deterministic.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
#[repr(i32)]
pub enum InputMethod {
    #[default]
    Keyboard = 0,
    Controller = 1,
    Touch = 2,
}

impl InputMethod {
    pub fn parse(name: &str) -> Result<Self, String> {
        match name.to_ascii_uppercase().as_str() {
            "KEYBOARD" => Ok(Self::Keyboard),
            "CONTROLLER" => Ok(Self::Controller),
            "TOUCH" => Ok(Self::Touch),
            _ => Err(format!("unknown input method '{name}'")),
        }
    }
}

/// Decode a held bitmask to its button names, in bit order.
pub fn names(mask: i32) -> Vec<String> {
    (0..BUTTONS.len())
        .filter(|b| mask & (1 << b) != 0)
        .map(|b| BUTTONS[b].to_string())
        .collect()
}

/// Encode a set of (case-insensitive) button names to a bitmask. An unknown
/// name is a load error — fail fast, never silent (ABI §6a).
pub fn mask_from_names(names: &[String]) -> Result<i32, String> {
    let mut mask = 0;
    for name in names {
        let up = name.to_ascii_uppercase();
        match BUTTONS.iter().position(|b| *b == up) {
            Some(bit) => mask |= 1 << bit,
            None => return Err(format!("unknown button '{name}'")),
        }
    }
    Ok(mask)
}

/// A cart-list entry for system carts (ABI §4b): the scripted installed
/// cart the launcher sees. In headless runs it comes from the feed's
/// object form; in console play from scanning real `cart.toml`s.
#[derive(Clone, Debug)]
pub struct SysCart {
    pub name: String,
    pub author: String,
    pub version: String,
    /// Launcher grouping metadata (ABI v1.2); defaults to Games when an
    /// older feed/manifest omits it.
    pub category: String,
    /// Exactly 4096 index bytes (64×64 8bpp) when present; the host
    /// substitutes the pinned placeholder otherwise (ABI §6a).
    pub icon: Option<Vec<u8>>,
}

impl SysCart {
    /// ABI metadata caps: the v1.1 fields are each ≤ 63 UTF-8 bytes and the
    /// v1.2 category is ≤ 31. A longer value is a configuration error at
    /// load, never truncation (ABI §4b).
    pub fn validate(&self) -> Result<(), String> {
        for (label, v) in [
            ("name", &self.name),
            ("author", &self.author),
            ("version", &self.version),
        ] {
            if v.len() > 63 {
                return Err(format!(
                    "cart {label} '{v}' exceeds the 63-byte ABI cap (§4b)"
                ));
            }
        }
        if self.category.len() > 31 {
            return Err(format!(
                "cart category '{}' exceeds the 31-byte ABI cap (§4b)",
                self.category
            ));
        }
        if let Some(icon) = &self.icon {
            if icon.len() != 4096 {
                return Err(format!(
                    "cart '{}' icon must be exactly 4096 bytes, got {}",
                    self.name,
                    icon.len()
                ));
            }
        }
        Ok(())
    }
}

/// Minimal base64 decode (standard alphabet, `=` padding) for feed icons —
/// not worth a dependency for one field.
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' || c == b'\n' || c == b'\r' {
            continue;
        }
        let v = ALPHA
            .iter()
            .position(|&a| a == c)
            .ok_or_else(|| format!("invalid base64 byte 0x{c:02x}"))? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

/// A scripted input feed: a sparse keyframe list (ABI §6a). Each entry sets
/// the held set at a frame; it persists until the next entry. The implicit
/// start is "nothing held." The object form also carries the scripted
/// cart list for system carts (ABI §4b).
pub struct Feed {
    keys: Vec<(i32, i32)>, // (frame, bitmask), ascending
    methods: Vec<(i32, InputMethod)>,
    pub carts: Vec<SysCart>,
}

impl Feed {
    pub fn empty() -> Self {
        Feed {
            keys: vec![],
            methods: vec![],
            carts: vec![],
        }
    }

    /// Parse a feed from JSON: either the bare array form, or the object
    /// form `{ "input": [...], "carts": [...] }` — the `carts` key feeds
    /// `sys_cart_*` for privileged runs and is ignored for normal carts
    /// (ABI §4b/§6a).
    pub fn from_json(s: &str) -> Result<Self, String> {
        let v: serde_json::Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
        let input = if v.is_array() {
            v.clone()
        } else {
            v.get("input")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([]))
        };
        let entries = input.as_array().ok_or("feed input is not an array")?;
        let mut keys = Vec::with_capacity(entries.len());
        let mut methods = Vec::new();
        for e in entries {
            let f = e["f"].as_i64().ok_or("feed entry missing integer 'f'")? as i32;
            let hold: Vec<String> = e["hold"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            keys.push((f, mask_from_names(&hold)?));
            if let Some(method) = e.get("method").and_then(|v| v.as_str()) {
                methods.push((f, InputMethod::parse(method)?));
            }
        }
        keys.sort_by_key(|k| k.0);
        methods.sort_by_key(|k| k.0);

        let mut carts = Vec::new();
        if let Some(list) = v.get("carts").and_then(|c| c.as_array()) {
            for e in list {
                let s = |k: &str| e[k].as_str().unwrap_or_default().to_string();
                let icon = match e.get("icon").and_then(|i| i.as_str()) {
                    Some(b64) => Some(base64_decode(b64)?),
                    None => None,
                };
                let cart = SysCart {
                    name: s("name"),
                    author: s("author"),
                    version: s("version"),
                    category: e
                        .get("category")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Games")
                        .to_string(),
                    icon,
                };
                cart.validate()?;
                carts.push(cart);
            }
        }
        Ok(Feed {
            keys,
            methods,
            carts,
        })
    }

    /// The held bitmask at `frame` — the last keyframe at or before it.
    pub fn at(&self, frame: i32) -> i32 {
        let mut mask = 0;
        for &(f, m) in &self.keys {
            if f <= frame {
                mask = m;
            } else {
                break;
            }
        }
        mask
    }

    /// Last scripted input method at or before `frame`; keyboard is the
    /// deterministic default for old/bare feeds.
    pub fn input_method_at(&self, frame: i32) -> InputMethod {
        let mut method = InputMethod::Keyboard;
        for &(f, m) in &self.methods {
            if f <= frame {
                method = m;
            } else {
                break;
            }
        }
        method
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_roundtrip() {
        let mask = mask_from_names(&[
            "a".into(),
            "RIGHT".into(),
            "x".into(),
            "Y".into(),
            "l".into(),
            "R".into(),
        ])
        .unwrap();
        assert_eq!(
            mask,
            (1 << 3) | (1 << 4) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10)
        );
        assert_eq!(
            names(mask),
            ["RIGHT", "A", "X", "Y", "L", "R"].map(String::from)
        );
    }

    #[test]
    fn unknown_button_is_error() {
        assert!(mask_from_names(&["JUMP".into()]).is_err());
    }

    #[test]
    fn feed_persists_until_next_keyframe() {
        let f = Feed::from_json(
            r#"[{"f":0,"hold":["RIGHT"]},{"f":10,"hold":[]},{"f":15,"hold":["A","RIGHT"]}]"#,
        )
        .unwrap();
        assert_eq!(f.at(0), 1 << 3);
        assert_eq!(f.at(9), 1 << 3); // still held
        assert_eq!(f.at(10), 0); // released
        assert_eq!(f.at(15), (1 << 4) | (1 << 3));
        assert_eq!(f.at(100), (1 << 4) | (1 << 3)); // last persists
    }

    #[test]
    fn empty_feed_holds_nothing() {
        assert_eq!(Feed::empty().at(7), 0);
        assert_eq!(Feed::from_json("[]").unwrap().at(7), 0);
        assert_eq!(Feed::empty().input_method_at(7), InputMethod::Keyboard);
    }

    #[test]
    fn feed_input_method_is_scripted_and_persistent() {
        let f = Feed::from_json(
            r#"[{"f":2,"hold":["A"],"method":"CONTROLLER"},
                {"f":8,"hold":[],"method":"TOUCH"}]"#,
        )
        .unwrap();
        assert_eq!(f.input_method_at(0), InputMethod::Keyboard);
        assert_eq!(f.input_method_at(2), InputMethod::Controller);
        assert_eq!(f.input_method_at(7), InputMethod::Controller);
        assert_eq!(f.input_method_at(8), InputMethod::Touch);
        assert!(Feed::from_json(r#"[{"f":0,"method":"MOUSE"}]"#).is_err());
    }

    #[test]
    fn object_form_reads_input_and_carts() {
        let f = Feed::from_json(
            r#"{"carts":[{"name":"x","author":"a","version":"1.0"}],
                "input":[{"f":0,"hold":["UP"]}]}"#,
        )
        .unwrap();
        assert_eq!(f.at(0), 1 << 0);
        assert_eq!(f.carts.len(), 1);
        assert_eq!(f.carts[0].name, "x");
        assert_eq!(f.carts[0].category, "Games");
        assert!(f.carts[0].icon.is_none());
    }

    #[test]
    fn feed_cart_icon_decodes_base64_and_checks_length() {
        // "AAAA" decodes to 3 bytes — not the required 4096.
        let bad = r#"{"carts":[{"name":"x","icon":"AAAA"}],"input":[]}"#;
        assert!(Feed::from_json(bad).is_err());

        // Exactly 4096 bytes: build from bytes instead.
        fn b64encode(data: &[u8]) -> String {
            const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let mut s = String::new();
            for chunk in data.chunks(3) {
                let b = [
                    chunk[0],
                    chunk.get(1).copied().unwrap_or(0),
                    chunk.get(2).copied().unwrap_or(0),
                ];
                let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
                s.push(A[(n >> 18) as usize & 63] as char);
                s.push(A[(n >> 12) as usize & 63] as char);
                s.push(if chunk.len() > 1 {
                    A[(n >> 6) as usize & 63] as char
                } else {
                    '='
                });
                s.push(if chunk.len() > 2 {
                    A[n as usize & 63] as char
                } else {
                    '='
                });
            }
            s
        }
        let icon: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let good = format!(
            r#"{{"carts":[{{"name":"x","icon":"{}"}}],"input":[]}}"#,
            b64encode(&icon)
        );
        let f = Feed::from_json(&good).unwrap();
        assert_eq!(f.carts[0].icon.as_deref(), Some(icon.as_slice()));
    }

    #[test]
    fn cart_field_cap_is_enforced() {
        let long = "n".repeat(64);
        let feed = format!(r#"{{"carts":[{{"name":"{long}"}}],"input":[]}}"#);
        assert!(Feed::from_json(&feed).is_err(), "63-byte cap (ABI §4b)");
        let ok = "n".repeat(63);
        let feed = format!(r#"{{"carts":[{{"name":"{ok}"}}],"input":[]}}"#);
        assert!(Feed::from_json(&feed).is_ok());
        let category = "c".repeat(32);
        let feed = format!(r#"{{"carts":[{{"name":"x","category":"{category}"}}],"input":[]}}"#);
        assert!(Feed::from_json(&feed).is_err(), "31-byte category cap");
    }
}
