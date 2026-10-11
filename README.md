# CircleFTP for Nuvio

A CircleFTP-only provider for the Nuvio app. It searches CircleFTP's documented API and returns direct HTTP(S) media links to Nuvio. The provider runs on the viewer's device and does not host, re-upload, or proxy media.

This is an independent, minimal implementation informed by the public API behavior documented in [mahdirdrmc/nuvio-plugin-circle-dflix](https://github.com/mahdirdrmc/nuvio-plugin-circle-dflix). That repository is a useful reference and provides CircleFTP plus DFLIX.live providers; this package focuses only on CircleFTP and does not include its DFLIX provider.

## Known CircleFTP URLs

- Website: `http://main.circleftp.net/`
- Website: `http://new.circleftp.net/`
- Website: `http://hd.circleftp.net/`
- API base used by this provider: `http://new.circleftp.net:5000/api`
- Example direct media host: `http://index.circleftp.net/FILE/...mkv`

The `main`, `new`, and `hd` web pages are not automatically interchangeable API endpoints. Use the API base configured in provider settings. The default API base is `new.circleftp.net:5000/api`, as documented in the reference project. All links still need to be accessible from the network Nuvio is running on.

## Requirements

- A network that can access CircleFTP and its direct media links.
- A version/build of Nuvio that supports local scraper plugins. Plugin support depends on the app distribution; some store-distributed builds do not support plugins.
- Your own TMDB API v3 key if Nuvio calls the provider using numeric TMDB IDs. The provider uses TMDB to resolve the title and year, then searches CircleFTP. Do not commit your API key to this repository. Enter it in the provider settings in Nuvio.

## Publish your repository

1. Create a **public** GitHub repository named `circleftp-nuvio`.
2. Extract the ZIP, then run `node configure-repo.js YOUR_GITHUB_USERNAME` from inside the extracted folder. If you choose a repository or branch other than `circleftp-nuvio` / `main`, pass those as the second and third arguments. The script sets the provider URLs in `manifest.json`.
3. Upload the contents of this folder to the repository root, including `manifest.json`, `providers/`, `src/`, `tests/`, `build.js`, `configure-repo.js`, `package.json`, and this README.
4. Commit and push the repository.
5. In Nuvio, open **Settings → Content & Discovery → Plugins** (label may vary by version) and add this manifest URL, replacing the username:

   `https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/circleftp-nuvio/main/manifest.json`

6. Refresh the repository and enable **CircleFTP**.
7. Open the CircleFTP provider settings. Leave `CircleFTP API Base URL` as `http://new.circleftp.net:5000/api` unless you have verified an alternative API endpoint. Enter your own TMDB API v3 key.
8. Test **Interstellar (2014)**. Check that the returned stream points to a CircleFTP direct media URL, such as one under `index.circleftp.net/FILE/`.

## API behavior

The provider expects these API operations:

- Search: `GET http://new.circleftp.net:5000/api/posts?searchTerm=<title>&order=desc`
- Detail: `GET http://new.circleftp.net:5000/api/posts/<post-id>`
- Movies: detail response has a direct link in its `content` field.
- TV: detail response contains seasons in `content`, with episodes and direct links in each season's `episodes[].link`.

These API response expectations are based on the reference project's documentation. The API could not be tested from this build environment, so it still needs a live test from your ISP/BDIX connection.

## Development

Requires Node.js 18+.

```bash
npm run build
npm test
```

`src/circleftp.js` is the editable source. `npm run build` copies it to `providers/circleftp.js`, which is what Nuvio loads from the manifest. Tests use mocked API responses and do not request live CircleFTP/TMDB endpoints.

## Troubleshooting

- **No results:** Open the API URL below in the same network as Nuvio. If the browser cannot reach it, the provider cannot search using that endpoint.

  `http://new.circleftp.net:5000/api/posts?searchTerm=Interstellar&order=desc`

- **TMDB lookup fails:** Check your TMDB API key in the CircleFTP provider settings.
- **No match for a title:** The release may be missing from the search index, or its title/year may differ.
- **Stream found but playback fails:** The direct file may be unavailable, the format may not be supported by the current player, or CircleFTP may require network access not available to the playback device.
- **HTTP/cleartext error:** Some Android app builds restrict HTTP requests. The API and media URLs supplied by CircleFTP use HTTP, so this depends on the Nuvio build and network configuration.

This is an unofficial project and is not affiliated with CircleFTP, Nuvio, or TMDB. Only access and stream content you are authorized to use.
