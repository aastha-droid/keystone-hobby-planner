# Keystone: AI Hobby Planner

Know what to buy before you start. A B2C lifestyle web app for beginners who want to try a new hobby but don't know which tools to buy. Built for the Ostad Presents YUNet AIgnite Buildathon 2026.

**Live app:** https://radiant-selkie-d7bd4e.netlify.app

## How it works
1. Enter a hobby (for example, watercolor) and a budget in BDT.
2. Google Gemini builds a beginner checklist of up to 10 items with local prices.
3. Tick what you already own.
4. See your readiness %, total cost, what is still to buy, and an over-budget warning.

Plans are saved in the browser (localStorage). No login needed.

## Tech
- HTML, CSS, JavaScript (no framework)
- Netlify hosting and a Netlify serverless function (`ai-hobby.js`, which belongs in `netlify/functions/` on the deployed site)
- Google Gemini API. The key is stored as the `GEMINI_API_KEY` environment variable on Netlify and is never in the front-end code.

## Why a server function?
The browser calls our own function, and the function calls Gemini. This keeps the API key secret, validates the AI's JSON, and retries with backup models if the AI is busy.

Built by Tasfia Tasneem Aastha, ULAB.
