fn main() {
    println!("cargo:rerun-if-env-changed=CALYX_PACKAGE_PROFILE");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let profile = std::env::var("CALYX_PACKAGE_PROFILE").unwrap_or_else(|_| "release".to_owned());
    let icon = match profile.as_str() {
        "release" => "../../assets/brand/native/calyx.ico",
        "sideb" => "../../assets/brand/native/calyx-sideb.ico",
        value => panic!("unsupported CALYX_PACKAGE_PROFILE: {value}"),
    };
    let icon = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(icon);
    winresource::WindowsResource::new()
        .set_icon(icon.to_str().expect("native icon path must be UTF-8"))
        .compile()
        .expect("failed to compile Windows application icon");
}
