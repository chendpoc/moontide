#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FuzzyMatch {
    pub matches: bool,
    pub score: f64,
}

pub(crate) fn fuzzy_match(query: &str, text: &str) -> FuzzyMatch {
    let query_lower = query.to_lowercase();
    let text_lower = text.to_lowercase();

    let primary = match_query(&query_lower, &text_lower);
    if primary.matches {
        return primary;
    }

    let swapped = swap_alpha_numeric(&query_lower);
    if swapped.is_empty() {
        return primary;
    }

    let swapped_match = match_query(&swapped, &text_lower);
    if swapped_match.matches {
        return FuzzyMatch {
            matches: true,
            score: swapped_match.score + 5.0,
        };
    }

    primary
}

fn match_query(query_lower: &str, text_lower: &str) -> FuzzyMatch {
    if query_lower.is_empty() {
        return FuzzyMatch {
            matches: true,
            score: 0.0,
        };
    }
    if query_lower.len() > text_lower.len() {
        return FuzzyMatch {
            matches: false,
            score: 0.0,
        };
    }

    let text_chars: Vec<char> = text_lower.chars().collect();
    let query_chars: Vec<char> = query_lower.chars().collect();

    let mut query_index = 0usize;
    let mut score = 0.0;
    let mut last_match_index: Option<usize> = None;
    let mut consecutive_matches = 0usize;

    for (index, ch) in text_chars.iter().enumerate() {
        if query_index >= query_chars.len() {
            break;
        }
        if *ch == query_chars[query_index] {
            let is_word_boundary = index == 0
                || text_chars
                    .get(index - 1)
                    .is_some_and(|previous| is_boundary_char(*previous));

            if index > 0 && last_match_index == Some(index - 1) {
                consecutive_matches += 1;
                score -= (consecutive_matches as f64) * 5.0;
            } else {
                consecutive_matches = 0;
                if let Some(last) = last_match_index {
                    score += ((index - last - 1) as f64) * 2.0;
                }
            }

            if is_word_boundary {
                score -= 10.0;
            }

            score += index as f64 * 0.1;
            last_match_index = Some(index);
            query_index += 1;
        }
    }

    if query_index < query_chars.len() {
        return FuzzyMatch {
            matches: false,
            score: 0.0,
        };
    }

    if query_lower == text_lower {
        score -= 100.0;
    }

    FuzzyMatch {
        matches: true,
        score,
    }
}

fn is_boundary_char(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '-' | '_' | '.' | '/' | ':')
}

fn swap_alpha_numeric(query_lower: &str) -> String {
    if let Some(captures) = regex_alpha_then_digits(query_lower) {
        return format!("{}{}", captures.1, captures.0);
    }
    if let Some(captures) = regex_digits_then_alpha(query_lower) {
        return format!("{}{}", captures.1, captures.0);
    }
    String::new()
}

fn regex_alpha_then_digits(input: &str) -> Option<(String, String)> {
    let mut letters = String::new();
    let mut digits = String::new();
    let mut phase = 0;
    for ch in input.chars() {
        if phase == 0 {
            if ch.is_ascii_alphabetic() {
                letters.push(ch);
            } else if ch.is_ascii_digit() {
                phase = 1;
                digits.push(ch);
            } else {
                return None;
            }
        } else if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            return None;
        }
    }
    if letters.is_empty() || digits.is_empty() {
        return None;
    }
    Some((letters, digits))
}

fn regex_digits_then_alpha(input: &str) -> Option<(String, String)> {
    let mut digits = String::new();
    let mut letters = String::new();
    let mut phase = 0;
    for ch in input.chars() {
        if phase == 0 {
            if ch.is_ascii_digit() {
                digits.push(ch);
            } else if ch.is_ascii_alphabetic() {
                phase = 1;
                letters.push(ch);
            } else {
                return None;
            }
        } else if ch.is_ascii_alphabetic() {
            letters.push(ch);
        } else {
            return None;
        }
    }
    if digits.is_empty() || letters.is_empty() {
        return None;
    }
    Some((digits, letters))
}

pub(crate) fn fuzzy_filter<T>(
    items: &[T],
    query: &str,
    get_text: impl Fn(&T) -> String,
) -> Vec<usize> {
    if query.trim().is_empty() {
        return (0..items.len()).collect();
    }

    let tokens: Vec<&str> = query
        .trim()
        .split(|ch: char| ch.is_whitespace() || ch == '/')
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.is_empty() {
        return (0..items.len()).collect();
    }

    let mut results = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let text = get_text(item);
        let mut total_score = 0.0;
        let mut all_match = true;
        for token in &tokens {
            let matched = fuzzy_match(token, &text);
            if matched.matches {
                total_score += matched.score;
            } else {
                all_match = false;
                break;
            }
        }
        if all_match {
            results.push((index, total_score));
        }
    }

    results.sort_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.into_iter().map(|(index, _)| index).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: fuzzy filter receives multi-token queries with slash separators.
    // Expected: items matching every token are returned in score order.
    // Invariant: filtering is read-only and does not depend on terminal state.
    #[test]
    fn fuzzy_filter_matches_tokens() {
        let items = ["Approval policy", "Base URL", "Trace"];
        let matched = fuzzy_filter(&items, "ap pol", |item| item.to_string());
        assert_eq!(matched.len(), 1);
        assert_eq!(items[matched[0]], "Approval policy");
    }
}
