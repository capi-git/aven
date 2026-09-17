# Agent orchestration in Aven

Choose **Orchestrator** in the composer's add menu and describe the work. The lead proposes assignments before workers start. Review task descriptions, file scopes, dependencies, worker models, and the parallel worker count, then start the run. The default is two workers and the maximum is four. Available providers and models depend on what is installed and enabled in Aven.

Workers appear under their lead in the sidebar. **View agents** opens their transcripts beside the lead. The lead can inspect results, request corrections, answer worker questions and approvals, and redirect supported workers while they run. Overlapping file scopes wait their turn. Stopping the lead also stops its workers.

Run history is saved locally. An interrupted run reopens paused for review. Active or paused teams remain in their owning window; stop or finish the run before moving their tabs to another window or Picture in Picture.

## Message queue

Follow-ups default to **Queue** while an agent is working. Explicit **Steer** remains available for supported providers. Waiting messages retain their order, including when a provider switch is pending. **Resume** runs the next queued message. Rejected submissions keep the draft available to edit or retry.

## Access and review

Worker coordination does not replace the selected provider's permissions or your review of the result. Workers use the project folder and can make changes within the access granted to their processes. Review the assignment scopes and resulting Git diff, especially when several workers edit the same project.

The local control transport is authenticated, bound to loopback and the owning window, and scoped to the lead's run. Its credentials are passed to the lead process rather than shown in chat or supplied to worker processes.

## Attribution

This implementation began with the MIT-licensed [MonoCode orchestration feature](https://github.com/hardbeat920/monocode/pull/228), commit `ed89e347af207b3639f1ed086f83f14201ed11b3`, with subsequent Aven changes. See the repository [NOTICE](../NOTICE) and [LICENSE](../LICENSE).
