// 跨裝置 mesh 介面：事件即時通知，定期 GET 補回遺漏或斷線期間的狀態。

const TERMINAL = new Set(['done', 'partial', 'failed', 'cancelled', 'rejected', 'expired']);

function abortError() {
  try {
    return new DOMException('操作已取消', 'AbortError');
  } catch {
    const error = new Error('操作已取消');
    error.name = 'AbortError';
    return error;
  }
}

function dispatchFrom(value) {
  return value?.dispatch ?? value;
}

function messageFrom(value) {
  return value?.message ?? value;
}

function dispatchResult(dispatch) {
  return {
    status: dispatch.status,
    summary: dispatch.summary ?? null,
    result: dispatch.result ?? null,
    sources: dispatch.sources ?? [],
    error: dispatch.error ?? null,
    costUsd: Number(dispatch.costUsd ?? 0),
  };
}

export function createMesh({ cloud, store = null, pollMs = 5000 } = {}) {
  if (!cloud) throw new Error('createMesh 需要 cloud');
  const questionListeners = new Set();
  const seenMessages = new Set();
  const waiters = new Set();
  let pollingQuestions = false;

  const fetchDispatch = async (id) => {
    const response = await cloud.getDispatch(id);
    return {
      dispatch: dispatchFrom(response),
      messages: response?.messages ?? [],
    };
  };
  const publishQuestion = async (message, dispatchHint) => {
    if (!message?.id || message.kind !== 'question' || seenMessages.has(message.id)) return;
    // 提問事件會送給雙方所有裝置。只有發起派工的那台主 agent 能回答，
    // 否則子 agent 所在的裝置會收到自己的問題，回一句「主任務已結束」蓋掉真正的答案。
    const myDevice = cloud.getDevice?.()?.id;
    if (message.fromDeviceId && message.fromDeviceId === myDevice) return;
    let dispatch = dispatchHint;
    if (!dispatch?.senderDeviceId && message.dispatchId) {
      try {
        dispatch = (await fetchDispatch(message.dispatchId)).dispatch;
      } catch {
        // 判斷不出發起裝置時不回答，由下一輪輪詢補上。
        return;
      }
    }
    if (!dispatch || dispatch.senderDeviceId !== myDevice) return;
    seenMessages.add(message.id);
    const question = {
      dispatchId: message.dispatchId,
      messageId: message.id,
      text: message.text,
      parent: dispatch?.parent ?? null,
    };
    for (const listener of questionListeners) {
      try {
        await listener(question);
      } catch {
        // 單一主 agent 回覆失敗不可阻塞其他訂閱者。
      }
    }
  };
  const onCloudEvent = (event) => {
    if (event.type !== 'dispatch_message') return;
    const message = messageFrom(event.payload);
    const dispatch = event.payload?.dispatch;
    void publishQuestion(message, dispatch);
  };
  const offCloud = cloud.subscribe?.(onCloudEvent) ?? (() => {});
  // 問題事件遺失時，以主 agent 發出的未結束派工清單補讀 messages。
  const pollQuestions = async () => {
    if (pollingQuestions || typeof cloud.listDispatches !== 'function') return;
    pollingQuestions = true;
    try {
      const dispatches = await cloud.listDispatches({ role: 'outgoing' });
      for (const dispatch of dispatches) {
        // 已結束的派工不會再有提問，不必每輪都查
        if (!dispatch?.id || TERMINAL.has(dispatch.status)) continue;
        try {
          const detail = await fetchDispatch(dispatch.id);
          const answered = new Set(detail.messages.filter((m) => m.kind === 'answer').map((m) => m.replyTo));
          for (const message of detail.messages) {
            if (!answered.has(message.id)) await publishQuestion(message, detail.dispatch);
          }
        } catch {
          // 單一派工暫時讀不到，不可中斷其他派工或下一輪補救。
        }
      }
    } catch {
      // 雲端離線時由後續 SSE 或輪詢補回。
    } finally {
      pollingQuestions = false;
    }
  };
  const questionPollTimer = setInterval(() => { void pollQuestions(); }, pollMs);
  void pollQuestions();

  const waitForDispatch = ({ dispatchId, signal, onUpdate }) =>
    new Promise((resolve, reject) => {
      let finished = false;
      let cancelled = false;
      let off = () => {};
      let timer = null;
      const clean = () => {
        off();
        if (timer) clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        waiters.delete(clean);
      };
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clean();
        fn(value);
      };
      const observe = (candidate) => {
        const dispatch = dispatchFrom(candidate);
        if (!dispatch || dispatch.id !== dispatchId) return;
        onUpdate?.(dispatch);
        if (TERMINAL.has(dispatch.status)) finish(resolve, dispatchResult(dispatch));
      };
      const poll = async () => {
        try {
          const result = await fetchDispatch(dispatchId);
          observe(result.dispatch);
        } catch {
          // 下一次輪詢或 SSE 仍可補到；不可因短暫離線結束本機等待。
        }
      };
      const onAbort = () => {
        if (cancelled) return;
        cancelled = true;
        void Promise.resolve().then(() => cloud.cancelDispatch?.(dispatchId)).catch(() => {});
        finish(reject, abortError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      off = cloud.subscribe?.((event) => {
        if (event.type === 'dispatch_created' || event.type === 'dispatch_update') observe(event.payload);
      }) ?? (() => {});
      timer = setInterval(poll, pollMs);
      waiters.add(clean);
      signal?.addEventListener('abort', onAbort, { once: true });
      void poll();
    });

  const waitForAnswer = ({ dispatchId, replyTo, signal }) =>
    new Promise((resolve, reject) => {
      let finished = false;
      let off = () => {};
      let timer = null;
      const clean = () => {
        off();
        if (timer) clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        waiters.delete(clean);
      };
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clean();
        fn(value);
      };
      const observe = (candidate) => {
        const message = messageFrom(candidate);
        if (message?.dispatchId === dispatchId && message.kind === 'answer' && message.replyTo === replyTo) {
          finish(resolve, String(message.text ?? ''));
        }
      };
      const poll = async () => {
        try {
          const result = await fetchDispatch(dispatchId);
          for (const message of result.messages) observe(message);
        } catch {
          // 以後續事件或輪詢補救。
        }
      };
      const onAbort = () => finish(reject, abortError());
      if (signal?.aborted) {
        onAbort();
        return;
      }
      off = cloud.subscribe?.((event) => {
        if (event.type === 'dispatch_message') observe(event.payload);
      }) ?? (() => {});
      timer = setInterval(poll, pollMs);
      waiters.add(clean);
      signal?.addEventListener('abort', onAbort, { once: true });
      void poll();
    });

  return {
    async listDevices() {
      const mine = cloud.getDevice?.()?.id;
      const devices = await cloud.listDevices();
      return devices
        .filter((device) => device.id !== mine)
        .map((device) => ({
          id: device.id,
          name: device.name,
          ownerName: device.ownerName,
          mine: Boolean(device.mine),
          online: Boolean(device.online),
          acceptRemote: device.acceptRemote,
        }));
    },
    async dispatch({ targetDeviceId, projectId, goal, context, options, parent, signal, onUpdate }) {
      if (signal?.aborted) throw abortError();
      // 專案要先存在伺服器上才能派工；背景同步可能還沒送到。成員不能更新專案，這裡的失敗可忽略。
      const project = (await store?.listProjects?.())?.find((p) => p.id === projectId);
      if (project) await cloud.putProject?.({ id: project.id, name: project.name, description: project.description ?? '' }).catch(() => {});
      const dispatch = await cloud.dispatch({ targetDeviceId, projectId, goal, context, options, parent });
      onUpdate?.(dispatch);
      if (TERMINAL.has(dispatch.status)) return dispatchResult(dispatch);
      return waitForDispatch({ dispatchId: dispatch.id, signal, onUpdate });
    },
    async ask({ dispatchId, text, signal }) {
      if (signal?.aborted) throw abortError();
      const message = await cloud.sendDispatchMessage(dispatchId, { kind: 'question', text });
      return waitForAnswer({ dispatchId, replyTo: message.id, signal });
    },
    onQuestion(listener) {
      questionListeners.add(listener);
      return () => questionListeners.delete(listener);
    },
    async answer({ dispatchId, replyTo, text }) {
      return cloud.sendDispatchMessage(dispatchId, { kind: 'answer', text, replyTo });
    },
    stop() {
      offCloud();
      clearInterval(questionPollTimer);
      for (const clean of [...waiters]) clean();
      waiters.clear();
    },
  };
}
