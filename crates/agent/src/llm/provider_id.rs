//! Built-in and custom provider identifiers for catalog and settings.

use std::borrow::Cow;
use std::fmt;

use anyhow::{
    Result,
    bail,
};
use serde::{
    Deserialize,
    Serialize,
};

/// Vendor identifier persisted by CLI/Desktop hosts.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub enum ProviderId {
    #[default]
    Deepseek,
    Agnes,
    Openai,
    Anthropic,
    Google,
    Custom(Cow<'static, str>),
}

impl Serialize for ProviderId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.as_str())
    }
}

impl<'de> Deserialize<'de> for ProviderId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        ProviderId::parse(&value).map_err(serde::de::Error::custom)
    }
}

impl ProviderId {
    pub fn as_str(&self) -> Cow<'_, str> {
        match self {
            Self::Deepseek => Cow::Borrowed("deepseek"),
            Self::Agnes => Cow::Borrowed("agnes"),
            Self::Openai => Cow::Borrowed("openai"),
            Self::Anthropic => Cow::Borrowed("anthropic"),
            Self::Google => Cow::Borrowed("google"),
            Self::Custom(slug) => Cow::Borrowed(slug),
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "deepseek" => Ok(Self::Deepseek),
            "agnes" => Ok(Self::Agnes),
            "openai" => Ok(Self::Openai),
            "anthropic" => Ok(Self::Anthropic),
            "google" => Ok(Self::Google),
            "" => bail!("provider must not be empty"),
            other => Ok(Self::Custom(Cow::Owned(other.to_owned()))),
        }
    }

    pub fn label(&self) -> Cow<'static, str> {
        match self {
            Self::Deepseek => Cow::Borrowed("DeepSeek"),
            Self::Agnes => Cow::Borrowed("Agnes AI"),
            Self::Openai => Cow::Borrowed("OpenAI"),
            Self::Anthropic => Cow::Borrowed("Anthropic"),
            Self::Google => Cow::Borrowed("Google"),
            Self::Custom(slug) => Cow::Owned(slug.to_string()),
        }
    }

    pub fn is_builtin(self) -> bool {
        !matches!(self, Self::Custom(_))
    }
}

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.as_str())
    }
}
