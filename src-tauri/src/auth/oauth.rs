use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::AppError;

pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_port: u16,
}

pub struct PkceChallenge {
    pub code_verifier: String,
    pub code_challenge: String,
    pub state: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: i64,
    pub refresh_token: String,
    pub refresh_token_expires_in: i64,
    pub token_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub email: Option<String>,
    pub avatar_url: String,
    pub name: Option<String>,
}

/// Generates a PKCE code verifier (43-128 chars, unreserved URI chars),
/// the corresponding code_challenge = base64url(sha256(verifier)), and a random state.
pub fn generate_pkce() -> PkceChallenge {
    let mut rng = rand::thread_rng();

    // Build code_verifier: 64 chars from [A-Za-z0-9-._~]
    let alphabet: Vec<char> =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
            .chars()
            .collect();
    let code_verifier: String = (0..64)
        .map(|_| alphabet[rng.gen_range(0..alphabet.len())])
        .collect();

    // code_challenge = base64url(sha256(code_verifier))
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let digest = hasher.finalize();
    let code_challenge = URL_SAFE_NO_PAD.encode(digest);

    // Random state: 32 bytes base64url encoded
    let state_bytes: Vec<u8> = (0..32).map(|_| rng.gen::<u8>()).collect();
    let state = URL_SAFE_NO_PAD.encode(&state_bytes);

    PkceChallenge {
        code_verifier,
        code_challenge,
        state,
    }
}

/// Builds the GitHub OAuth authorization URL.
pub fn build_auth_url(config: &OAuthConfig, pkce: &PkceChallenge, port: u16) -> String {
    let redirect_uri = format!("http://localhost:{}/callback", port);
    format!(
        "https://github.com/login/oauth/authorize\
         ?client_id={}\
         &redirect_uri={}\
         &state={}\
         &code_challenge={}\
         &code_challenge_method=S256\
         &scope=repo%20user%3Aemail",
        urlencoding_simple(&config.client_id),
        urlencoding_simple(&redirect_uri),
        urlencoding_simple(&pkce.state),
        urlencoding_simple(&pkce.code_challenge),
    )
}

/// Exchanges an authorization code for tokens via GitHub's token endpoint.
pub async fn exchange_code(
    config: &OAuthConfig,
    code: &str,
    pkce: &PkceChallenge,
    port: u16,
) -> Result<TokenResponse, AppError> {
    let redirect_uri = format!("http://localhost:{}/callback", port);
    let client = Client::new();

    let params = [
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", pkce.code_verifier.as_str()),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let status = response.status().as_u16();
    if !response.status().is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(AppError::GithubApi {
            status,
            message: body,
        });
    }

    let token: TokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    Ok(token)
}

/// Refreshes an access token using a refresh token.
pub async fn refresh_access_token(
    config: &OAuthConfig,
    refresh_token: &str,
) -> Result<TokenResponse, AppError> {
    let client = Client::new();

    let params = [
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let status = response.status().as_u16();
    if !response.status().is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(AppError::GithubApi {
            status,
            message: body,
        });
    }

    let token: TokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    Ok(token)
}

/// Fetches the authenticated GitHub user's profile and primary email.
/// The access token is never logged.
pub async fn fetch_user_info(access_token: &str) -> Result<GitHubUser, AppError> {
    let client = Client::new();
    let auth_header = format!("Bearer {}", access_token);

    // GET /user
    let user_response = client
        .get("https://api.github.com/user")
        .header("Authorization", &auth_header)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "gitease/0.1")
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let status = user_response.status().as_u16();
    if !user_response.status().is_success() {
        let body = user_response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(AppError::GithubApi {
            status,
            message: body,
        });
    }

    let mut user: GitHubUser = user_response
        .json()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // If the profile email is None, fetch from /user/emails
    if user.email.is_none() {
        let emails_response = client
            .get("https://api.github.com/user/emails")
            .header("Authorization", &auth_header)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "gitease/0.1")
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?;

        if emails_response.status().is_success() {
            let emails: Vec<GitHubEmail> = emails_response
                .json()
                .await
                .unwrap_or_default();

            // Prefer primary + verified, fall back to first verified
            let primary = emails.iter().find(|e| e.primary && e.verified);
            let fallback = emails.iter().find(|e| e.verified);
            if let Some(entry) = primary.or(fallback) {
                user.email = Some(entry.email.clone());
            }
        }
    }

    Ok(user)
}

/// Internal type for /user/emails response parsing.
#[derive(Deserialize)]
struct GitHubEmail {
    email: String,
    primary: bool,
    verified: bool,
}

/// Minimal percent-encoding for URL query values (encodes space, &, =, #, +).
fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '&' => out.push_str("%26"),
            '=' => out.push_str("%3D"),
            '#' => out.push_str("%23"),
            '+' => out.push_str("%2B"),
            _ => out.push(c),
        }
    }
    out
}
