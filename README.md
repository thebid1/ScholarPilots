# ScholarPilot AI × 0G Zero Cup

<p align="center">
  <strong>AI-native scholarship copilot powered by 0G decentralized infrastructure.</strong>
</p>

<p align="center">
  <a href="#-roadmap">Roadmap</a> •
  <a href="#-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## 📖 Overview

**ScholarPilot AI** helps students discover, evaluate, and apply for scholarships worldwide. It matches opportunities to a student's profile, tracks application deadlines with milestone timelines, drafts Statements of Purpose, reviews CVs, and answers scholarship questions through an AI chat interface.

This project is built for the **[0G Zero Cup](https://0g.ai/arena/zero-cup)** hackathon. Our mission is to move every layer of the copilot — data, inference, and user identity — onto 0G's decentralized stack.

### Why 0G?

Scholarship data is often scattered across websites, PDFs, and closed databases. By storing the catalog on **0G Storage**, we make the dataset:

- **Open and verifiable** — anyone can fetch the catalog by its root hash.
- **Censorship-resistant** — no single server can take the dataset down.
- **Composability-ready** — future AI agents can read the same catalog permissionlessly.

In Phase 2, AI inference moves to **0G Compute Router**. In Phase 3, user achievement is anchored on-chain with an **Agentic ID NFT**.

---

## 🏆 Roadmap

| Phase | Focus | 0G Integration | Status |
|---|---|---|---|
| **Phase 1** | Decentralized scholarship catalog | Catalog stored on **0G Storage (Galileo testnet)** | ✅ Live |
| **Phase 2** | AI copilot backend | **0G Compute Router** for scholarship matching, SOP/CV/deadline inference | 🚧 Planned |
| **Phase 3** | User ownership & achievements | **Agentic ID NFT** minted on application completion | 🚧 Planned |

---

## ✨ Features

### Discover
- Browse **46 verified international scholarships** across **23 countries**.
- Search by title, funder, or country.
- Filter by country chips.
- Sort by **best match**, **due soonest**, **due latest**, or **tracking first**.
- Each opportunity shows amount, deadline, eligibility, degree level, and a relevance score.

### Track
- Add scholarships to your personal pipeline.
- Auto-generated milestones: Draft SOP, Request Recommendations, Finalise Documents, Submit Application.
- Track application status: Discovered → In Progress → Submitted.
- Health score based on completed milestones.
- Deadline countdowns and "due soon" alerts.

### Chat with ScholarPilot
- Ask for scholarship matches based on your profile.
- Request a tailored Statement of Purpose for any scholarship.
- Get CV feedback.
- Review upcoming deadlines.
- Deterministic fallbacks keep the app usable even when the AI service is offline.

### PWA Support
- Installable as a progressive web app.
- Service worker caches static assets and navigation pages for offline access.
- Mobile-first design with a responsive layout for desktop.

---

## 🧱 0G Integration (Phase 1)

The scholarship catalog is stored as a JSON file on the **0G Galileo testnet**.

### How it works

1. `app/lib/scholarships.json` contains the verified catalog.
2. `scripts/upload-scholarships.mjs` reads the file, computes its Merkle tree, and uploads it to 0G Storage using the TypeScript SDK.
3. The upload returns a **root hash** that uniquely identifies the file on 0G.
4. The app stores the root hash in `NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH`.
5. At runtime, `app/lib/scholarships.ts` fetches the catalog from the 0G Storage indexer via `/file?root=<rootHash>`.
6. Fetched catalogs are cached in `localStorage` for fast subsequent loads.

### Testnet Configuration

| Parameter | Value |
|---|---|
| Network | 0G Galileo Testnet |
| Chain ID | `16602` |
| RPC | `https://evmrpc-testnet.0g.ai` |
| Storage Indexer | `https://indexer-storage-testnet-turbo.0g.ai` |
| Faucet | `https://faucet.0g.ai` |
| Storage Explorer | `https://storagescan-galileo.0g.ai` |

### Catalog on 0G

You can verify the deployed catalog directly through the indexer:

```
https://indexer-storage-testnet-turbo.0g.ai/file?root=<NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH>
```

The Discover page displays the root hash and a link to this endpoint when the catalog loads successfully.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           Next.js 14 App                │
│  React 18 • TypeScript • Tailwind CSS   │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│      app/lib/scholarships.ts            │
│  • fetchScholarshipsFrom0G(rootHash)    │
│  • loadScholarships()                   │
│  • useScholarships() React hook         │
└──────────────────┬──────────────────────┘
                   │
      ┌────────────┴────────────┐
      ▼                         ▼
0G Storage (Galileo)      localStorage cache
Indexer /file?root=...
```

### Data flow

- **0G-first:** Every app load tries to fetch the catalog from 0G Storage.
- **Cache layer:** A successful fetch is stored in `localStorage` under `scholarpilot_scholarships_cache`.
- **No local mock fallback:** The runtime does not fall back to the local JSON file. `scholarships.json` is kept only as the source for re-uploads or updates.

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| UI Icons | Lucide React |
| State | React hooks + localStorage |
| Storage | 0G Storage (Galileo testnet) |
| AI (Phase 1 fallback) | Google Gemini API |
| AI (Phase 2) | 0G Compute Router |
| Identity (Phase 3) | Agentic ID (ERC-7857) |

### Project Structure

```
.
├── app/
│   ├── components/          # React components
│   │   ├── ApplicationsScreen.tsx
│   │   ├── ChatInterface.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── OpportunitiesScreen.tsx
│   │   ├── OpportunityCard.tsx
│   │   ├── ProfileForm.tsx
│   │   ├── RegisterSW.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── scholarships.ts     # 0G fetch + cache + hook
│   │   ├── scholarships.json   # Upload source catalog
│   │   ├── mockData.ts         # Scoring, deadlines, lookups
│   │   ├── gemini.ts           # AI helper functions
│   │   └── storage.ts          # localStorage utilities
│   ├── types/               # TypeScript type definitions
│   ├── opportunities/
│   ├── applications/
│   ├── chat/
│   ├── page.tsx             # Entry point with onboarding/auth
│   └── layout.tsx           # Root layout + service worker registration
├── public/
│   ├── sw.js                # Service worker
│   ├── manifest.json        # PWA manifest
│   └── *.png                # App icons
├── scripts/
│   └── upload-scholarships.mjs  # 0G Storage upload script
├── .env.example
├── next.config.mjs
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A small amount of 0G testnet tokens for uploads

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the values:

```env
# Optional: AI fallback for Phase 1
NEXT_PUBLIC_GEMINI_API_KEY=your-gemini-api-key

# 0G Storage testnet
NEXT_PUBLIC_OG_STORAGE_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH=0x-your-uploaded-root-hash

# Deployer wallet (used only by the upload script)
OG_TESTNET_PRIVATE_KEY=0x-your-private-key
```

> ⚠️ **Never commit `.env.local`.** It contains sensitive keys. The upload private key is especially dangerous if exposed.

### 3. Run the app locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

If you already have a root hash configured, the Discover page will load the catalog from 0G Storage.

### 4. Upload the scholarship catalog to 0G Storage

If you want to upload your own copy of the catalog:

a. Get testnet `0G` tokens from the [faucet](https://faucet.0g.ai).

b. Add your deployer private key to `.env.local`:

```env
OG_TESTNET_PRIVATE_KEY=0x...
```

c. Run the upload script:

```bash
npm run upload:scholarships
```

d. Copy the printed root hash into `.env.local`:

```env
NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH=0x...
```

e. Restart the dev server. The Discover page will show a **"Catalog loaded from 0G Storage"** indicator.

### 5. Build for production

```bash
npm run build
```

This exports a static site to `/dist`, ready for any static host.

---

## 🧪 Build & Test

```bash
npm run lint    # ESLint
npm run build   # Static export to /dist
```

Both commands must pass before pushing changes.

---

## 🚀 Deployment

The app is configured for static export (`output: 'export'`, `distDir: 'dist'`). You can deploy `/dist` to:

- **Vercel** — import the repo and set environment variables in the dashboard.
- **GitHub Pages** — copy `/dist` to the `gh-pages` branch.
- **Netlify** — drag and drop `/dist` or connect the repo.
- **Any static host** — upload the contents of `/dist`.

### Environment variables for deployment

Set these in your hosting dashboard:

- `NEXT_PUBLIC_GEMINI_API_KEY`
- `NEXT_PUBLIC_OG_STORAGE_INDEXER`
- `NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH`

Do **not** set `OG_TESTNET_PRIVATE_KEY` in the hosting environment. It is only needed locally to run the upload script.

---

## 🎥 Demo Flow

A good 3-minute demo video covers:

1. **Onboarding** — landing on the app, signing in, and completing the profile.
2. **Discover** — browsing scholarships loaded from 0G Storage and clicking the root-hash link.
3. **Track** — adding a scholarship to the pipeline and viewing milestones.
4. **Chat** — asking ScholarPilot for matches or a tailored SOP.
5. **Verification** — opening the 0G Storage explorer to prove the catalog is on-chain.

---

## 🔮 Future Work

### Phase 2 — 0G Compute Backend

- Replace Google Gemini with **0G Compute Router** for all AI inference.
- Scholarship matching, SOP drafting, CV review, and deadline summaries will run through decentralized compute nodes.
- Reduce dependency on centralized AI APIs.

### Phase 3 — Agentic Identity

- Integrate **Agentic ID (ERC-7857)**.
- When a student completes an application milestone or submits an application, they can mint an NFT representing their ScholarPilot agent's progress.
- Creates a portable, on-chain record of scholarship achievements.

---

## 🔒 Security Notes

- `.env.local` is gitignored and must never be committed.
- `OG_TESTNET_PRIVATE_KEY` is used only by `scripts/upload-scholarships.mjs` and is never sent to the browser.
- `NEXT_PUBLIC_GEMINI_API_KEY` is embedded in the client bundle. Treat it as public-facing and rotate it if exposed.
- Use a dedicated testnet wallet for uploads. Do not reuse a mainnet wallet or hold significant funds in the deployer account.

---

## 🙏 Acknowledgments

Built for the **0G Zero Cup** hackathon.

- [0G Storage](https://0g.ai/) for decentralized data availability.
- [0G Compute](https://0g.ai/) for the upcoming decentralized inference layer.
- [Agentic ID](https://github.com/0glabs/Agentic-ID) for the on-chain identity standard.

---

## 📄 License

MIT
