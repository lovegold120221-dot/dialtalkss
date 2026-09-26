# DialTalk

DialTalk is a **single-screen Abbie voice dialer** for ABI Tech. The UI intentionally contains no CRM dashboard, queue, analytics, customer cards, or additional views.

## Included

- Android-inspired in-call screen
- Editable phone-number display
- LiveKit browser audio call to \`AbbieCSR\`
- Mute and speaker controls
- Real incoming-audio visualizer using the Web Audio API
- Secure server-side LiveKit token generation
- Explicit dispatch to the \`AbbieCSR\` worker
- Vercel-ready Vite frontend

## Vercel environment variables

Set these as encrypted server-side environment variables:

\`\`\`text
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
\`\`\`

Never expose \`LIVEKIT_API_SECRET\` through a \`VITE_\` variable.

## Voice worker

The separate \`AbbieCSR\` worker uses the same LiveKit project and should hold provider keys such as \`GEMINI_API_KEY\` and \`CARTESIA_API_KEY\`.

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

Production build:

\`\`\`bash
npm run build
\`\`\`
