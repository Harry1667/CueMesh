# CueMesh — one-minute demo

Status on November 7, 2026: the website is available and automated checks pass, but the user reports that device linking is unfinished. The full demonstration is **not ready for recording** until the rehearsal below succeeds. Interface footage can be captured now. Sample workspace data is not evidence of live execution.

Public website: https://cuemesh.looptw.com/workspace. Both extensions must connect to `https://cuemesh.looptw.com` (server origin without `/api`). Browser actions run in the extension; the website displays synced work.

## Link the two devices

1. Harry supplies both devices with the cloud-enabled extension build. The audited source is `ext/mvp` at `361d413`; fetched main does not include that cloud implementation. Keep both extension side panels open throughout the rehearsal.
2. In each extension's **帳號** page, confirm the same server URL and sign in. Name the devices clearly, such as `Ethan-A` and `Harry-B`. Confirm both appear online. Signing in only on the website does not register an execution device.
3. To demonstrate another person's browser, use two accounts. On A, select the recording project, open **專案成員 → 產生邀請碼**. On B, use **加入別人的專案**, then select that shared project. Both accounts must appear as members. Using one account on two devices demonstrates multi-device access only.
4. On B, set **是否接受派工 → 每次都問我**. Check B appears in A's **在哪裡執行** list. Each execution device needs its own working provider configuration; website sign-in does not transfer API keys.
5. First send one harmless task using A's device selector. B must receive the request, accept it, finish it and return a result visible to A. Then rehearse the parent-agent scene below using A's local engine. These are separate paths; selecting B directly does not by itself demonstrate a parent agent answering a child.

If B is missing: check cloud-enabled build, server URL, extension login, open side panels, online state, shared-project membership and B's acceptance setting. If any step fails, keep the cross-device scene out of the final take until Harry resolves that boundary.

## Rehearse the actual scenes

- **Council:** select council mode with both Anthropic and OpenAI enabled. Ask one short question. Observe two actual provider answers and a synthesis identifying agreement/disagreement; model names alone do not prove two calls.
- **Browser approval:** ask `@browser` to navigate to `https://example.com/?cuemesh=demo`. Reject the first request and confirm no navigation. Start a fresh request, approve it and confirm navigation. Use the actual approval state; not every ordinary link is classified as high risk. Denial blocks that action, not necessarily the entire AI run.
- **Parent → child:** keep A set to **這台裝置** and use a prompt such as: `請把一個子任務派給共享專案中在線的 Harry-B。目標網址是 https://example.com/?cuemesh=demo。請子 agent 先向你確認網址，收到回答後才要求操作批准，讀取頁面標題並回報。你要回答它的問題，等結果回來後再總結。` Replace the device name with the real name. Model tool use is not deterministic; observe the required events rather than assuming the prompt guarantees them.
- **Required evidence:** B's task consent → child question → A's answer → B's browser approval → actual browser result → A's completed report. If the child does not ask, rerun or omit the question/answer claim.
- **Website:** sign in to the same account on the public site, stay in live mode and refresh the relevant project. Confirm the real run's agents, activity and result. Show an artifact only if that run actually produced one. Website reload signs out in this implementation.

Do not film API-key settings. Capture the real sequence before editing; shorten waiting periods and label them `等待已加速` when applicable. No need to finish model/network work in real time within the final minute.

## 60-second cut and narration

| Time      | Picture                                                     | Narration                                                                       |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 0:00–0:06 | Multiple AI tabs, copy/paste                                | 我們每天都在當 AI 的人工中介：複製、貼上、重新解釋。                            |
| 0:06–0:12 | Select context, open CueMesh                                | CueMesh 把你選取的內容變成共同任務，交給多個 AI 分工。                          |
| 0:12–0:22 | Two actual provider answers, then synthesis                 | 不同 AI 獨立回答，再整理共識與分歧。                                            |
| 0:22–0:32 | Reject, then a fresh approved navigation                    | 操作由你決定。拒絕，動作就不會執行；密碼與付款欄位留給你輸入。                  |
| 0:32–0:48 | A dispatches; B consents, asks, approves; A receives result | 工作也能派給另一台裝置或隊友。對方先同意，子 agent 回頭確認，核准操作後再回報。 |
| 0:48–0:55 | Real synced run in website                                  | 任務、進度和成果，都回到同一個工作區。                                          |
| 0:55–1:00 | CueMesh mark and github.com/Harry1667/CueMesh               | CueMesh，One Cue. Every AI.                                                     |

This cut demonstrates context, council, approval, collaboration and the website. Model routing can be shown through actual agent/model labels in those shots. It does not prove every device, model, failure case or production guarantee; keep the pitch to what the rehearsal visibly demonstrates.
