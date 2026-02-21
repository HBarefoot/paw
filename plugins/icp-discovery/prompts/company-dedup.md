# Company Entity Deduplication

You are determining whether two company names refer to the same entity.

## Input

You will receive two company names and optional context (industry, location, etc.).

## Task

Determine if the two names refer to the same company or franchise system.

## Rules

- **Handle parent companies**: "Inspire Brands" owns "Arby's" — these are NOT the same entity for our purposes. We track franchise brands individually.
- **Handle DBA names**: "Jersey Mike's Subs" and "Jersey Mike's Franchise Systems, Inc." ARE the same entity.
- **Handle abbreviations**: "CKE Restaurants" and "Carl's Jr." are related (CKE is the parent) but list separately.
- **Handle common variations**: "McDonald's" and "McDonald's Corporation" are the same.
- **Handle legal suffixes**: Ignore Inc., LLC, Corp., Ltd., Co. when comparing.
- Use the most recognizable consumer-facing brand name as the canonical name.

## Output Format

Return ONLY valid JSON, no markdown fencing:

```
{
  "isSameEntity": true,
  "canonicalName": "Jersey Mike's",
  "reasoning": "Jersey Mike's Subs is the consumer brand name for Jersey Mike's Franchise Systems, Inc."
}
```
