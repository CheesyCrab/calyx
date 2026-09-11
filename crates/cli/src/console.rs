//! `calyx console` — the boot-to-launcher runner side of
//! ABI §4b: the launcher is an ordinary system cart; `sys_launch` /
//! `sys_exit` are its verified *intent*, and this module is what acts on
//! that intent in real play — swap to the picked cart, return to the
//! launcher. Settings v1 are transient, so every swap is a fresh boot
//! (the determinism story: a chainloaded cart runs exactly like a cold
//! start).
//!
//! Console directory layout: one subdirectory per cart —
//!   <dir>/<name>/cart.toml   [cart] name/author/version(+ system=true)
//!   <dir>/<name>/cart.wasm   the built cart
//!   <dir>/<name>/icon.bin    optional, exactly 4096 index bytes
//! The cart named `launcher` boots first and is excluded from the list
//! it serves.

use std::path::{Path, PathBuf};

use calyx_core::{Feed, Host, InputMethod, SysCart, SysEvent};

use crate::timing::PresentationRate;

/// One installed cart the console can chainload.
pub struct ConsoleCart {
    pub meta: SysCart,
    pub wasm: PathBuf,
    /// Instantiate privileged (its manifest says `system = true`) — how
    /// the settings page gets `sys_exit`.
    pub system: bool,
    pub display: DisplayProfile,
    pub input: InputProfile,
    pub presentation: PresentationRate,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum DisplayProfile {
    #[default]
    Classic,
    Hd,
}

impl DisplayProfile {
    pub const fn dimensions(self) -> (i32, i32) {
        match self {
            Self::Classic => (320, 240),
            Self::Hd => (1280, 720),
        }
    }

    fn parse(value: Option<String>, manifest: &Path) -> Result<Self, String> {
        match value.as_deref().unwrap_or("classic") {
            "classic" => Ok(Self::Classic),
            "hd" => Ok(Self::Hd),
            other => Err(format!(
                "{}: unknown display profile {other:?}",
                manifest.display()
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum InputProfile {
    #[default]
    Classic,
    Extended,
}

impl InputProfile {
    fn parse(value: Option<String>, manifest: &Path) -> Result<Self, String> {
        match value.as_deref().unwrap_or("classic") {
            "classic" => Ok(Self::Classic),
            "extended" => Ok(Self::Extended),
            other => Err(format!(
                "{}: unknown input profile {other:?}",
                manifest.display()
            )),
        }
    }
}

fn pin_settings_last(list: &mut [ConsoleCart]) {
    list.sort_by_key(|cart| cart.meta.name.eq_ignore_ascii_case("settings"));
}

fn manifest_str(doc: &toml_edit::DocumentMut, key: &str) -> Option<String> {
    doc.get("cart")?.get(key)?.as_str().map(String::from)
}

fn presentation_rate(
    doc: &toml_edit::DocumentMut,
    manifest: &Path,
) -> Result<PresentationRate, String> {
    let raw = doc
        .get("cart")
        .and_then(|cart| cart.get("presentation"))
        .and_then(|value| value.as_integer())
        .unwrap_or(60);
    let raw = i32::try_from(raw).map_err(|_| {
        format!(
            "{}: presentation cadence is outside the supported range",
            manifest.display()
        )
    })?;
    PresentationRate::parse(raw).map_err(|error| format!("{}: {error}", manifest.display()))
}

pub struct ConsoleRoles {
    pub launcher: Vec<u8>,
    pub boot: Option<Vec<u8>>,
    pub hd_boot: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConsoleScreen {
    Boot,
    Launcher,
    HdBoot,
    Cart,
}

/// Scan a console directory. Role carts are privileged orchestration assets,
/// excluded from the installed list served through `calyx.sys`.
pub fn scan_carts(dir: &Path) -> Result<(Vec<ConsoleCart>, ConsoleRoles), String> {
    let mut subdirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("read {}: {e}", dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("cart.toml").exists())
        .collect();
    subdirs.sort();

    let mut list = Vec::new();
    let mut launcher: Option<Vec<u8>> = None;
    let mut boot_role: Option<Vec<u8>> = None;
    let mut hd_boot_role: Option<Vec<u8>> = None;
    for sub in subdirs {
        let manifest = sub.join("cart.toml");
        let text = std::fs::read_to_string(&manifest)
            .map_err(|e| format!("{}: {e}", manifest.display()))?;
        let doc: toml_edit::DocumentMut =
            text.parse().map_err(|e| format!("parse cart.toml: {e}"))?;
        let name = manifest_str(&doc, "name")
            .ok_or_else(|| format!("{}: cart.name missing", sub.display()))?;
        let system = doc
            .get("cart")
            .and_then(|c| c.get("system"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let role = manifest_str(&doc, "role").map(|value| value.to_ascii_lowercase());
        let display = DisplayProfile::parse(manifest_str(&doc, "display"), &manifest)?;
        let input = InputProfile::parse(manifest_str(&doc, "input"), &manifest)?;
        let presentation = presentation_rate(&doc, &manifest)?;
        let wasm = sub.join("cart.wasm");
        if !wasm.exists() {
            return Err(format!("{}: cart.wasm missing", sub.display()));
        }

        let role = role.or_else(|| {
            name.eq_ignore_ascii_case("launcher")
                .then(|| "launcher".into())
        });
        if let Some(role) = role {
            if !system {
                return Err(format!(
                    "{}: cart role {role:?} requires system = true",
                    sub.display()
                ));
            }
            let bytes = std::fs::read(&wasm).map_err(|e| format!("{}: {e}", wasm.display()))?;
            match role.as_str() {
                "launcher" if launcher.is_none() => launcher = Some(bytes),
                "boot" if boot_role.is_none() => boot_role = Some(bytes),
                "hd-boot" if hd_boot_role.is_none() => {
                    if display != DisplayProfile::Hd {
                        return Err(format!(
                            "{}: hd-boot role requires display = \"hd\"",
                            manifest.display()
                        ));
                    }
                    hd_boot_role = Some(bytes)
                }
                "launcher" | "boot" | "hd-boot" => {
                    return Err(format!("duplicate cart role {role:?}"))
                }
                _ => return Err(format!("{}: unknown cart role {role:?}", sub.display())),
            }
            continue;
        }

        let icon_path = sub.join("icon.bin");
        let icon = if icon_path.exists() {
            let bytes =
                std::fs::read(&icon_path).map_err(|e| format!("{}: {e}", icon_path.display()))?;
            Some(bytes)
        } else {
            None
        };
        let meta = SysCart {
            name,
            author: manifest_str(&doc, "author").unwrap_or_else(|| "unknown".into()),
            version: manifest_str(&doc, "version").unwrap_or_else(|| "0.0".into()),
            category: manifest_str(&doc, "category").unwrap_or_else(|| "Games".into()),
            icon,
        };
        meta.validate()?;
        list.push(ConsoleCart {
            meta,
            wasm,
            system,
            display,
            input,
            presentation,
        });
    }

    let launcher = launcher.ok_or("console dir has no `launcher` cart")?;
    // Settings is a console utility, not a game: keep it at the far end
    // regardless of its directory name or the casing used in its manifest.
    pin_settings_last(&mut list);
    Ok((
        list,
        ConsoleRoles {
            launcher,
            boot: boot_role,
            hd_boot: hd_boot_role,
        },
    ))
}

fn metas(list: &[ConsoleCart]) -> Vec<SysCart> {
    list.iter().map(|c| c.meta.clone()).collect()
}

/// Boot a cart for the console: privileged when it (or the launcher role)
/// calls for it, always served the same installed list. Errors name the
/// cart — a multi-cart catalog needs to say *which* cart failed.
fn boot(
    wasm: &[u8],
    system: bool,
    list: &[ConsoleCart],
    w: i32,
    h: i32,
    name: &str,
    input_method: InputMethod,
) -> Result<Host, String> {
    let mut host = if system {
        Host::new_system(wasm, w, h, metas(list)).map_err(|e| format!("load {name}: {e}"))?
    } else {
        Host::new(wasm, w, h).map_err(|e| format!("load {name}: {e}"))?
    };
    host.set_input_method(input_method);
    if let Err(fault) = host.start() {
        return Err(format!(
            "{name}: fault in start() ({}): {}",
            fault.kind, fault.msg
        ));
    }
    Ok(host)
}

/// What a frame's sys events ask the runner to do.
pub enum SysAction {
    None,
    Launch(usize),
    Exit,
}

pub fn action_of(events: &[SysEvent]) -> SysAction {
    // First event wins the frame; a cart emitting several is a launcher
    // bug the golden will show anyway.
    match events.first() {
        Some(SysEvent::Launch(i)) => SysAction::Launch(*i as usize),
        Some(SysEvent::Exit) => SysAction::Exit,
        None => SysAction::None,
    }
}

/// The headless console: run the boot→launch→exit loop for `frames` total
/// frames, the feed applied to whichever cart is active with **local**
/// frame indices (every boot replays like a cold start). Swap decisions
/// land on stderr so the CLI regression test can assert the loop.
///
/// With `out`, drops palette-applied PNG sidecars of the active screen
/// (final frame always, every `every`-th global frame when `every > 0`)
/// plus a small `status.json` — the launcher render, verifiable without
/// a window. Frames are captured before a swap boots the next cart, so
/// the sidecar at a swap frame shows what was actually on screen.
pub fn run_headless(
    dir: &Path,
    feed: &Feed,
    frames: i32,
    _w: i32,
    _h: i32,
    out: Option<&Path>,
    every: i32,
) -> Result<(), String> {
    let (list, roles) = scan_carts(dir)?;
    let initial_method = feed.input_method_at(0);
    let (initial_wasm, initial_name) = roles
        .boot
        .as_ref()
        .map_or((&roles.launcher, "launcher"), |wasm| (wasm, "boot"));
    let (classic_w, classic_h) = DisplayProfile::Classic.dimensions();
    let mut host = boot(
        initial_wasm,
        true,
        &list,
        classic_w,
        classic_h,
        initial_name,
        initial_method,
    )?;
    eprintln!("console: booted {initial_name} ({} carts)", list.len());
    let mut swaps = 0u32;
    let mut active_role = initial_name.to_string();
    let mut active_screen = if initial_name == "boot" {
        ConsoleScreen::Boot
    } else {
        ConsoleScreen::Launcher
    };
    let mut pending_hd: Option<usize> = None;

    for gf in 0..frames {
        let f = host.frames_run();
        host.set_input_method(feed.input_method_at(f));
        let rec = match host.step(feed.at(f)) {
            Ok(rec) => rec,
            Err(fault) => {
                return Err(format!(
                    "console fault at f{} ({}): {}",
                    fault.f, fault.kind, fault.msg
                ));
            }
        };
        if let Some(out) = out {
            let is_sample = every > 0 && gf % every == 0;
            if is_sample || gf == frames - 1 {
                crate::dump::save_png(out, gf, host.fb(), host.palette_rgb());
            }
        }
        match action_of(&rec.sys) {
            SysAction::Launch(i) => {
                let target = if active_screen == ConsoleScreen::HdBoot {
                    if i != 0 {
                        return Err(format!("hd-boot launch {i} out of range"));
                    }
                    pending_hd
                        .take()
                        .ok_or("hd-boot launched without a pending cart")?
                } else {
                    i
                };
                let cart = list
                    .get(target)
                    .ok_or_else(|| format!("launch {target} out of range"))?;
                let wasm = std::fs::read(&cart.wasm).map_err(|e| {
                    format!("read {} ({}): {e}", cart.wasm.display(), cart.meta.name)
                })?;
                if active_screen != ConsoleScreen::HdBoot && cart.display == DisplayProfile::Hd {
                    let hd_boot = roles.hd_boot.as_ref().ok_or_else(|| {
                        format!("{} requires the missing hd-boot role", cart.meta.name)
                    })?;
                    let (hd_w, hd_h) = DisplayProfile::Hd.dimensions();
                    host = boot(
                        hd_boot,
                        true,
                        std::slice::from_ref(cart),
                        hd_w,
                        hd_h,
                        "hd-boot",
                        initial_method,
                    )?;
                    pending_hd = Some(target);
                    active_screen = ConsoleScreen::HdBoot;
                    active_role = "hd-boot".to_string();
                    eprintln!("console: hd-boot -> {}", cart.meta.name);
                } else {
                    let (cart_w, cart_h) = cart.display.dimensions();
                    eprintln!("console: launch {} -> {}", target, cart.meta.name);
                    host = boot(
                        &wasm,
                        cart.system,
                        &list,
                        cart_w,
                        cart_h,
                        &cart.meta.name,
                        initial_method,
                    )?;
                    active_role = cart.meta.name.clone();
                    active_screen = ConsoleScreen::Cart;
                }
                swaps += 1;
            }
            SysAction::Exit => {
                pending_hd = None;
                eprintln!("console: exit -> launcher");
                host = boot(
                    &roles.launcher,
                    true,
                    &list,
                    classic_w,
                    classic_h,
                    "launcher",
                    initial_method,
                )?;
                active_role = "launcher".to_string();
                active_screen = ConsoleScreen::Launcher;
                swaps += 1;
            }
            SysAction::None => {}
        }
    }
    if let Some(out) = out {
        std::fs::create_dir_all(out).map_err(|e| format!("create {}: {e}", out.display()))?;
        let status = serde_json::json!({
            "mode": "console",
            "carts": list.len(),
            "frames_run": frames,
            "initial_role": initial_name,
            "final_role": active_role,
            "swaps": swaps,
        });
        let text = serde_json::to_string_pretty(&status).unwrap();
        std::fs::write(out.join("status.json"), text)
            .map_err(|e| format!("write {}/status.json: {e}", out.display()))?;
    }
    eprintln!("console: done ({swaps} swaps)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cart(name: &str) -> ConsoleCart {
        ConsoleCart {
            meta: SysCart {
                name: name.to_string(),
                author: "test".to_string(),
                version: "0.0".to_string(),
                category: "Games".to_string(),
                icon: None,
            },
            wasm: PathBuf::new(),
            system: false,
            display: DisplayProfile::Classic,
            input: InputProfile::Classic,
            presentation: PresentationRate::Hz60,
        }
    }

    #[test]
    fn settings_is_pinned_after_games() {
        let mut carts = vec![cart("Settings"), cart("Alpha"), cart("Zulu")];
        pin_settings_last(&mut carts);
        let names: Vec<&str> = carts.iter().map(|cart| cart.meta.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "Zulu", "Settings"]);
    }

    #[test]
    fn presentation_metadata_defaults_to_sixty_and_accepts_only_thirty_or_sixty() {
        let path = Path::new("cart.toml");
        let default: toml_edit::DocumentMut = "[cart]\nname = \"Default\"\n".parse().unwrap();
        assert_eq!(
            presentation_rate(&default, path).unwrap(),
            PresentationRate::Hz60
        );
        let thirty: toml_edit::DocumentMut = "[cart]\nname = \"Thirty\"\npresentation = 30\n"
            .parse()
            .unwrap();
        assert_eq!(
            presentation_rate(&thirty, path).unwrap(),
            PresentationRate::Hz30
        );
        let invalid: toml_edit::DocumentMut = "[cart]\nname = \"Invalid\"\npresentation = 24\n"
            .parse()
            .unwrap();
        assert!(presentation_rate(&invalid, path)
            .unwrap_err()
            .contains("30 or 60"));
    }
}
