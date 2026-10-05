<div align="center">

# Pip

[![License](https://img.shields.io/badge/LICENSE-MIT-5C9E31?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/RUNS%20ON-CLOUDFLARE%20WORKERS-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Built by](https://img.shields.io/badge/BUILT%20BY-JGALEA-8A2BE2?style=for-the-badge&logo=github&logoColor=white)](https://github.com/jgalea)

**A talking AI learning buddy for kids, built to show a classroom how AI can help you learn instead of doing the work for you.**

</div>

Pip is a small blue character with googly eyes. A grown-up holds the mic button while a child asks a question, and Pip answers in a big speech bubble and out loud. It runs in the browser, so it works on a laptop plugged into a projector or on an iPad, with nothing to install.

There are four modes:

- Ask me anything: a short answer at the child's level with one vivid comparison, then a question back to keep them thinking.
- Quiz me: one question at a time on a topic the child picks. Wrong answers get a hint instead of the answer, right ones get confetti.
- Help me think: works through homework with guiding questions and never hands over the answer.
- Português: teaches European Portuguese phrases, read aloud with a Portuguese voice.

An age picker (5–7, 8–10, 11–13) changes how Pip talks. The rules for talking to children live in the server's system prompt, where the page can't change them: no personal details, sensitive topics go to a trusted grown-up, and Pip says so when it isn't sure.

Nothing is stored. There are no accounts, no recordings and no server logs. The conversation lives in the browser tab and resets when you switch mode.

## Run it

You need Node 20+ and an [Anthropic API key](https://console.anthropic.com).

```
npm install
echo "ANTHROPIC_API_KEY=your-key" > .env
npm run dev
```

Open http://localhost:8787.

## Deploy

```
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

The chat endpoint is rate limited to 20 requests a minute per IP, set in `wrangler.jsonc`.

## Presenting

- Use Chrome or Safari. Voice input uses the browser's speech recognition, which sends audio to Google (Chrome) or Apple (Safari) for transcription. Typing works everywhere.
- Hold the mic button or the space bar while talking, and let go to send.
- F toggles full screen, M mutes Pip, and Esc or tapping Pip stops it mid-sentence.

## How it works

`src/index.ts` is a Cloudflare Worker that serves the static page and streams answers from Claude through `POST /api/chat`. `src/prompts.ts` holds the system prompt for each mode and age group. The front end in `public/` is plain HTML, CSS and JavaScript: the browser's Web Speech API does speech-to-text and text-to-speech, and replies are spoken sentence by sentence as they stream in.

## License

MIT
