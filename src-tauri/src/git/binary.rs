use serde::Serialize;

/// Maximum file size for binary preview (10 MB)
pub const MAX_PREVIEW_SIZE: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewFileType {
    Image,
    Svg,
    Unknown,
}

pub fn detect_file_type(path: &str) -> PreviewFileType {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "ico" | "tiff" | "tif" | "avif" => {
            PreviewFileType::Image
        }
        "svg" => PreviewFileType::Svg,
        _ => PreviewFileType::Unknown,
    }
}

pub fn extension_to_mime(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

pub fn is_previewable(ft: &PreviewFileType) -> bool {
    matches!(ft, PreviewFileType::Image | PreviewFileType::Svg)
}
