# Prompt Defense: host it for your class

A static website that teaches prompting and the model settings (temperature, top-p, top-k, max tokens, penalties, stop sequences, system prompts). There is nothing to build: `index.html` is the whole game.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | The game. Upload this anywhere that serves web pages. |
| `proxy/worker.js` | Optional class server. Keeps **your** API key secret. |
| `proxy/wrangler.toml` | Settings for deploying the class server on Cloudflare. |

## Step 1: put the site online (5 minutes)

Any static host works. Easiest options, all free:

- **GitHub Pages:** create a repository, upload `index.html`, then Settings > Pages > deploy from the main branch.
- **Netlify:** drag the folder onto app.netlify.com/drop.
- **Cloudflare Pages:** create a project and upload the folder.

Open the address. First-time visitors see a welcome card with a **Connect a model** button (also at the top right, labeled "Add your key" until a model is connected). They can also start in the **Playground**, which needs no key.

## Step 2: choose how students connect a model

### Option A: students bring their own key (no server)

Leave the teacher configuration at its defaults. Each student opens **Connect a model**, picks a provider, types any model ID, and pastes their own API key.

- Providers built in: Anthropic, OpenAI, OpenRouter (many models), and any OpenAI-compatible API (paste its base URL).
- The key stays in the student's browser and is sent only to the provider they picked. By default it's forgotten when the tab closes.
- Good for older students and adults who already have keys. Younger students shouldn't hold keys. Use Option B.
- Tell students to create a key with a **low spend limit**.
- Some providers refuse calls made directly from a browser. If a provider fails with a network error, use Option B.

### Option B: your key stays secret on a class server (recommended for a classroom)

A web page can never hide a key, because anyone can read it. The class server holds the key instead. Students only get a **class passcode** that you can change or revoke.

1. Install Node, then in the `proxy` folder run `npx wrangler login`.
2. Edit `ALLOWED_MODELS` in `wrangler.toml` to list the models you allow, for example
   `{"claude-haiku-5-5":"anthropic","gpt-4o-mini":"openai"}`.
3. Add your secrets (it asks you to paste each one):
   ```
   npx wrangler secret put CLASS_PASSCODE
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put OPENAI_API_KEY      # only if you allow OpenAI models
   ```
4. Run `npx wrangler deploy`. It prints your server address.
5. Set `ALLOWED_ORIGINS` in `wrangler.toml` to your site's address (for example `https://yourschool.github.io`) and deploy again. Then nobody else's website can use your server.
6. Open `index.html` and edit the teacher configuration near the top:
   ```js
   window.PD_CONFIG = {
     proxyUrl: 'https://prompt-defense-proxy.YOURNAME.workers.dev',
     models: [
       { id: 'claude-haiku-5-5', label: 'Claude Haiku (fast)', provider: 'anthropic' },
       { id: 'gpt-4o-mini', label: 'GPT mini', provider: 'openai' }
     ],
     allowBYOK: false,        // true also lets students use their own key
     defaultEngine: 'live'
   };
   ```
7. Re-upload `index.html`. Students pick a model from your list and type the passcode.

The server caps tokens per request (`MAX_TOKENS_CAP`), limits requests per minute (`RATE_PER_MIN`), only runs the models you list, and trims prompt length. Set a monthly spend limit on your provider account as well.

## Live engine or simulated dice

Students choose in **Connect a model**:

- **Live model:** the settings go to the model as real API parameters. The model writes the plan itself, so students see real behavior, real cut-offs from max tokens, and real stop sequences. Dials a provider doesn't offer (Anthropic has no frequency or presence penalty or seed; OpenAI has no top-k) are greyed out with an explanation.
- **Simulated dice:** the model only reads the order. The page rolls the dice using the dials and shows the odds of every choice. Works with any model and shows exactly why a result happened.

The **Playground** lessons always use the simulated dice, so they need no key at all (except the "Doctrine" lesson, which asks a model to read the student's system prompt).

## The interface

- A top bar with the four modes, a connection chip (green when a model is connected) and a light/dark switch.
- The radar stays in view while the right-hand panel scrolls, and the Send, Fire and Run buttons stay pinned at the bottom of the panel.
- Each plan shows a launch timeline against the missile's arrival time, plus a budget bar.
- Ctrl+Enter (or Cmd+Enter) sends the order. Works on phones and tablets.

## Things worth knowing

- **Cost:** one order is one model call. "Test reliability ×10" in live mode makes 10 calls. A small, fast model keeps this cheap.
- **Reasoning models** sometimes ignore temperature or top-p. The game drops the setting the provider rejects and says so.
- **Privacy:** nothing is sent to anyone except the model provider (or your class server). The game stores no student data. Progress is saved in each student's browser only.
- **Changing the game:** the code is plain JavaScript in `index.html`. Search for `LEVELS` for campaign levels and `QUESTS` for the Playground lessons.
