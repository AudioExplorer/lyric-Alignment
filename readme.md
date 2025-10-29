# AudioShake Lyrics Alignment Demo

A browser-based demo for working with the AudioShake Tasks API to generate time-aligned lyrics against audio and video sources. This tool allows you to:

- Load demo media assets
- Submit alignment jobs
- Poll task status
- View word-timed lyric highlighting synced to playback
- Inspect alignment metadata and raw JSON
- Associate multiple alignments with matching assets
- Dynamically switch between audio stems
- Pan, mono-mix, and audition output directly in the browser


Live Demo (GitHub Pages):  
https://audioexplorer.github.io/lyric-Alignment/

### Requirements

- You must provide your own AudioShake API key.  Get your API key at 
[AudioShake](https://dashboard.AudioShake.ai)

- demo-assets.json, a JSON formatted Demo Assets list 

The AudioShake API requires media to be accessible via public urls or pre-signed AWS URLs. 

For the purposes of this demo, we created a simple tool to quickly generate a simple and secure demo-assets.json that will contain a list of pre-signed assets file from your own AWS Bucket. 

Learn more about how to create you own demo-assets.json with our [create-demo-assets](https://dev.to/dzeitman/keep-your-aws-s3-demo-assets-live-automating-presigned-urls-with-nodejs-9b0) tool. 

---

## Features

### Time-Aligned Lyrics
Displays word-level highlighting driven by per-word timestamp metadata from the alignment model.

### Web Audio Mixer
Implements channel splitting, gain control, routing, and a mono duplication mode using the Web Audio API. Includes Safari AudioContext unlock handling.

### Demo Asset Loader
Loads from:
- `demo-assets.json` (local file)
- Drag-and-drop (hosted)

### Asset and Alignment Association
Tasks are matched to media assets by:
- Filename
- Basename stripping
- Fuzzy token matching
- Query parameter removal

This is useful for associating multiple stems or variations referencing a common root filename.

### Task Creation and Polling
Creates new alignment tasks via the AudioShake Tasks API and polls status until completion.

### Persistent State
Stores:
- API key (IndexedDB)
- Last selected asset
- Last selected alignment

Persists across page refreshes.

### Developer Debug Tools
Built-in utilities for:
- Creating tasks
- Listing tasks
- Fetching task by ID
- Clearing debug output
- Reloading demo assets

All responses are printed for inspection.

### Video Support
Supports alignment playback for MP4 media.

---

## Matching Logic
Tasks are associated to assets through:

- `audioUrl`
- `targets[].url`
- `preferredAudioUrl`
- `audioSources[]`

The matching logic is implemented in `matchTasksToAssets()` within `app-v2.js`.  
See citation below.  [oai_citation:0‡app-v2.js](sediment://file_00000000cc4061f6a1325638385b7db8)

---

## Alignment Rendering
`renderLyricsFromJson()`:
- Fetches JSON alignment output
- Wraps each word in a span with `data-start` and `data-end`
- Smoothly scrolls the container to keep the active word centered
- Enforces a maximum text container height to match video player bounds

---

## Persistence (IndexedDB)
Stores API keys using a dedicated `audioshake_alignment_demo` object store. Values are read on initialization to avoid re-entry of API credentials.

---

## API Endpoints Used

`POST /tasks`  
Creates a new alignment task for a given media URL.

`GET /tasks/:id`  
Returns stage, outputs, and status.

`GET /tasks`  
Lists recent tasks, optionally filtered.

---

## Error Handling
The UI surfaces failures for:
- Expired signed URLs
- Missing alignment targets
- Invalid JSON
- Unavailable outputs

Users are instructed to recreate tasks or refresh demo assets as required.

