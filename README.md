# Steam Profile Lookup

[![Deploy to GitHub Pages](https://github.com/Gr1zZtv/SteamID/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Gr1zZtv/SteamID/actions/workflows/deploy-pages.yml)
[![Live site](https://img.shields.io/badge/live-GitHub%20Pages-66c0f4)](https://gr1zztv.github.io/SteamID/)

A fast, privacy-friendly Steam profile lookup that runs entirely as a static website. Search with a custom Steam username, a 17-digit Steam ID, or a full profile URL to view public account details and open the player across useful Steam and CS2 services.

**[Open Steam Profile Lookup](https://gr1zztv.github.io/SteamID/)**

## Features

- Accepts custom Steam usernames, SteamID64 values, and profile URLs
- Displays public profile details, status, avatars, playtime, groups, and most-played games
- Converts SteamID64 into SteamID2, SteamID3, and AccountID locally
- Shows VAC and trade-ban information included in Steam's public profile response
- Links directly to Steam, SteamDB, Leetify, CSStats, CSGO Exchange, SteamID.io, SteamRep, FACEIT Finder, and CSFloat
- Uses no Steam login, trade token, or Steam Web API key
- Stores no searches or profile data
- Works without a build system or application server
- Automatically deploys to GitHub Pages after every push to `main`

## Supported searches

| Input | Example |
| --- | --- |
| Custom profile name | `contentking` |
| SteamID64 | `76561198824832322` |
| Custom profile URL | `https://steamcommunity.com/id/contentking` |
| Numeric profile URL | `https://steamcommunity.com/profiles/76561198824832322` |

Steam display names are not supported as unique searches because multiple accounts can use the same display name. A username search refers to the account's custom Steam profile address.

## How it works

1. The browser normalizes the entered username, SteamID64, or profile URL.
2. It requests Steam's public profile XML through a staggered pool of public CORS proxies.
3. The first valid XML response is parsed and displayed.
4. ID conversions are calculated locally with exact `BigInt` arithmetic.

The proxy pool exists because Steam's community profile endpoint does not allow this GitHub Pages origin to read its response directly. The site starts fallback requests only when an earlier service is slow and cancels outstanding requests after receiving valid Steam XML.

## Privacy

This project does not have a database, user accounts, analytics, or server-side storage. It only displays information Steam already exposes publicly.

Profile requests pass through one of the configured public CORS proxy services, so those independent services can receive the requested public Steam profile URL and normal network metadata such as an IP address. Never enter passwords, session tokens, trade URLs, or other private information—the search accepts public profile identifiers only.

## Run locally

No installation or build step is required. Clone the repository and serve the folder with any static HTTP server:

```bash
git clone https://github.com/Gr1zZtv/SteamID.git
cd SteamID
python -m http.server 8080
```

Then open `http://localhost:8080`.

Opening `index.html` directly may work, but a local HTTP server more closely matches the deployed environment and avoids browser restrictions associated with `file://` pages.

## Project structure

```text
SteamID/
├── .github/workflows/deploy-pages.yml  # Automatic GitHub Pages deployment
├── assets/
│   ├── css/styles.css                  # Responsive site styling
│   └── js/app.js                       # Search, parsing, conversion, and rendering
├── .nojekyll                           # Serve the static files without Jekyll
├── index.html                          # Page structure and content
└── README.md
```

## Deployment

GitHub Actions publishes the repository to GitHub Pages whenever `main` changes. The workflow can also be started manually from the repository's **Actions** tab.

Live URL: [https://gr1zztv.github.io/SteamID/](https://gr1zztv.github.io/SteamID/)

## Limitations

- Private Steam profiles may expose only basic account information.
- A Steam custom profile name is different from a non-unique display name.
- Lookups depend on Steam Community and at least one public proxy being available.
- External player tools are independent websites and may not track every account.
- The site intentionally avoids extra Steam requests, authenticated APIs, and inventory loading to reduce rate-limit exposure.

## Contributing

Issues and focused pull requests are welcome. Please keep the project static, lightweight, privacy-conscious, and usable without a Steam API key.

## Disclaimer

This project is not affiliated with Valve Corporation. Steam and the Steam logo are trademarks of Valve Corporation.
