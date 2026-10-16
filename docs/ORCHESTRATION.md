# Agent orchestration in Aven

Choose **Orchestrator** in the composer's add menu and describe the work. The lead proposes assignments before workers start. Review task descriptions, file scopes, dependencies, worker models, and the parallel worker count, then start the run. The default is two workers and the maximum is four. Available providers and models depend on what is installed and enabled in Aven.

Workers appear under their lead in the sidebar. **View agents** opens their transcripts beside the lead. The lead can inspect results, request corrections, answer worker questions and approvals, and redirect supported workers while they run. Overlapping file scopes wait their turn. Stopping the lead also stops its workers.

Run history is saved locally. An interrupted run reopens paused for review. Active or paused teams remain in their owning window; stop or finish the run before moving their tabs to another window.

## Message queue

Follow-ups default to **Queue** while an agent is working. Explicit **Steer** remains available for supported providers. Waiting messages retain their order, including when a provider switch is pending. **Resume** runs the next queued message. Rejected submissions keep the draft available to edit or retry.

## Discussions between two chats

Choose **Discuss** in the composer's add menu, beside Plan mode and Orchestrator, to have this chat talk your message through with another open chat or a new chat with the model you choose. A chip such as **Discuss with Codex · 3 rounds** appears in the message box; its dropdown picks the other chat (or **New chat with…** a model) and the rounds, one to six, and says why a chat cannot join or why sending would not start yet. Each round is one reply from each chat; the last rounds you chose are offered next time. Send the message to start: it becomes the topic. Typing `/discuss` turns the mode on too, keeping the rest of the message as the topic. Starting waits until both chats are idle with nothing waiting for you.

The discussion opens as one conversation page beside the chat that started it (between it and a new partner chat), focused. Your topic comes first, then each chat's finished replies as messages: the chat that opened the topic on the left, the one responding on the right, each with its own pixel mascot in its provider's colour (Claude coral, Codex blue), its model's name and its part ("Opened the topic", "Responding"). Round dividers separate the rounds, the chat answering now shows as typing with its mascot stepping, and the closing note ends the page; when all rounds complete, each side's last message gets one small hop. Long replies fold behind **Show more**. The page reads each reply from that chat's own transcript, the same text Aven relays, so nothing is stored twice. Its header has **Stop** and **Resume**. Closing the page stops nothing; **Open discussion** in the bar above either chat's message box, or pressing the connector in the sidebar, brings it back. Finished discussions are kept so their page can still be opened (the newest twenty per window); their replies stay in the two chats.

Aven brokers the conversation; neither agent gets a way to message the other, and an agent can never start one. The first chat receives the topic. Each time a chat finishes its turn, Aven sends that chat's final reply to the other one as a labelled message, shortened past 8,000 characters with a note. A relayed reply is passed as written: its `/` skills and `@` references are not expanded in the receiving chat. Relayed messages appear in the receiving transcript with the sender's marks. When the rounds are used up, Aven posts a short note in both chats; it never asks a model to summarise.

A discussion pauses when either chat needs an approval or has a question, when a chat refuses or cannot take the message, and when the chat that should answer next is busy with your own turn, has your messages queued or has a card waiting in its message box. Your own work comes first; the relay never joins the queue or steers a running turn. Press **Resume** in the bar above either chat's message box or on the discussion's page to continue, or **Stop** to end it; a reply already in progress finishes but is not passed on. Stopping either chat's turn ends the discussion; an error pauses it, and Resume sends the same message again.

Discussions are saved locally and are driven by the window that started them. Reloading or closing that window pauses them. If a chat moves to another window, its bar there can stop the discussion, or resume it once both chats are open in that window.

## Access and review

Worker coordination does not replace the selected provider's permissions or your review of the result. Workers use the project folder and can make changes within the access granted to their processes. Review the assignment scopes and resulting Git diff, especially when several workers edit the same project.

The local control transport is authenticated, bound to loopback and the owning window, and scoped to the lead's run. Its credentials are passed to the lead process rather than shown in chat or supplied to worker processes.

## Attribution

This implementation began with the MIT-licensed [MonoCode orchestration feature](https://github.com/hardbeat920/monocode/pull/228), commit `ed89e347af207b3639f1ed086f83f14201ed11b3`, with subsequent Aven changes. See the repository [NOTICE](../NOTICE) and [LICENSE](../LICENSE).
