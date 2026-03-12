# Cookie Consent Policy (Implemented)

## Region-based behavior

- `EU/EEA + UK + CH`:
  - Policy mode: `opt_in`
  - Non-essential cookies (`analytics`, `marketing`) default to `off`
  - User must explicitly allow before tracking
- `US`:
  - Policy mode: `opt_out`
  - `analytics` default to `on`, user can switch off via preferences
  - `marketing` default to `off`
- `Other regions`:
  - Policy mode: `notice`
  - `analytics` default to `on`, user can change anytime
  - `marketing` default to `off`

## Data model

Stored in browser `localStorage` under `cookie_consent_v1`:

- `necessary` (always `true`)
- `analytics` (`true/false`)
- `marketing` (`true/false`)
- `policy` (`opt_in` / `opt_out` / `notice`)
- `countryCode`
- `version`
- `updatedAt`

## Tracking integration

Button-click analytics is sent only when:

- `window.cookieConsent.canUse("analytics") === true`

## Primary legal references

- EU GDPR (Regulation (EU) 2016/679):
  - https://eur-lex.europa.eu/eli/reg/2016/679/oj
- EU ePrivacy Directive 2002/58/EC (Article 5(3) cookies):
  - https://eur-lex.europa.eu/eli/dir/2002/58/oj
- UK ICO guidance on cookies and similar technologies:
  - https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/
- California privacy rights (CPRA/CCPA) overview (California DOJ/OAG):
  - https://oag.ca.gov/privacy/ccpa

> This implementation is product/engineering support, not legal advice.
