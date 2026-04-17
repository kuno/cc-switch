pub fn build_version() -> &'static str {
    option_env!("CCSWITCH_BUILD_VERSION")
        .or(option_env!("CCSWITCH_PRODUCT_VERSION"))
        .unwrap_or(env!("CARGO_PKG_VERSION"))
}
