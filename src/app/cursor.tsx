"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { Session, WsMessage } from "../../worker/src/index";

type MessageState = { in: string; out: string };
type MessageAction = { type: "in" | "out"; message: string };
function messageReducer(state: MessageState, action: MessageAction) {
  switch (action.type) {
    case "in":
      return { ...state, in: action.message };
    case "out":
      return { ...state, out: action.message };
    default:
      return state;
  }
}

function useHighlight(duration = 250) {
  const timestampRef = useRef(0);
  const [highlighted, setHighlighted] = useState(false);
  function highlight() {
    timestampRef.current = Date.now();
    setHighlighted(true);
    setTimeout(() => {
      const now = Date.now();
      if (now - timestampRef.current >= duration) {
        setHighlighted(false);
      }
    }, duration);
  }
  return [highlighted, highlight] as const;
}

export function Cursors(props: { id: string }) {
  const [mounted, setMounted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [messageState, dispatchMessage] = useReducer(messageReducer, {
    in: "",
    out: "",
  });
  const [cursors, setCursors] = useState<Map<string, Session>>(new Map());
  const [highlightedIn, highlightIn] = useHighlight();
  const [highlightedOut, highlightOut] = useHighlight();

  useEffect(() => {
    setMounted(true);
  }, []);

  function startWebSocket() {
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsProtocol}://${process.env.NEXT_PUBLIC_WS_HOST}/ws?id=${props.id}`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      highlightOut();
      dispatchMessage({ type: "out", message: "get-cursors" });
      const message: WsMessage = { type: "get-cursors" };
      ws.send(JSON.stringify(message));
    };
    ws.onmessage = (message) => {
      const messageData: WsMessage = JSON.parse(message.data);
      highlightIn();
      dispatchMessage({ type: "in", message: messageData.type });
      switch (messageData.type) {
        case "quit":
          setCursors((prev) => {
            const newCursors = new Map(prev);
            newCursors.delete(messageData.id);
            return newCursors;
          });
          break;
        case "join":
          setCursors((prev) => {
            const newCursors = new Map(prev);
            const session = newCursors.get(messageData.id);
            if (!session) {
              newCursors.set(messageData.id, {
                id: messageData.id,
                x: -1,
                y: -1,
              });
            }
            return newCursors;
          });
          break;
        case "move":
          setCursors((prev) => {
            const newCursors = new Map(prev);
            const session = newCursors.get(messageData.id);
            if (session) {
              session.x = messageData.x;
              session.y = messageData.y;
            } else {
              newCursors.set(messageData.id, messageData);
            }
            return newCursors;
          });
          break;
        case "get-cursors-response":
          setCursors(
            new Map(
              messageData.sessions.map((session) => [session.id, session]),
            ),
          );
          break;
        default:
          break;
      }
    };
    ws.onclose = () => setCursors(new Map());
    return ws;
  }

  const lastSentTimestamp = useRef(0);
  const sendInterval = 20;

  useEffect(() => {
    const abortController = new AbortController();
    document.addEventListener(
      "mousemove",
      (ev) => {
        const w = window.innerWidth,
          h = window.innerHeight;
        const x = ev.pageX / w,
          y = ev.pageY / h;
        const now = Date.now();
        if (
          now - lastSentTimestamp.current > sendInterval &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          const message: WsMessage = { type: "move", id: props.id, x, y };
          wsRef.current.send(JSON.stringify(message));
          lastSentTimestamp.current = now;
          highlightOut();
          dispatchMessage({ type: "out", message: "move" });
        }
      },
      {
        signal: abortController.signal,
      },
    );
    return () => abortController.abort();
  }, []);

  useEffect(() => {
    wsRef.current = startWebSocket();
    return () => wsRef.current?.close();
  }, [props.id]);

  function sendMessage() {
    highlightOut();
    dispatchMessage({ type: "out", message: "message" });
    wsRef.current?.send(
      JSON.stringify({ type: "message", data: "Ping" } satisfies WsMessage),
    );
  }

  return (
    <>
      <div className="flex border">
        <div className="px-2 py-1 border-r">WebSocket Connections</div>
        <div className="px-2 py-1"> {cursors.size} </div>
      </div>
      <div className="flex border">
        <div className="px-2 py-1 border-r">Messages</div>
        <div className="flex flex-1">
          <div className="px-2 py-1 border-r">↓</div>
          <div
            className="w-full px-2 py-1 [word-break:break-word] transition-colors duration-500"
            style={{
              backgroundColor: highlightedIn ? "#ef4444" : "transparent",
            }}
          >
            {messageState.in}
          </div>
        </div>
        <div className="flex flex-1">
          <div className="px-2 py-1 border-x">↑</div>
          <div
            className="w-full px-2 py-1 [word-break:break-word] transition-colors duration-500"
            style={{
              backgroundColor: highlightedOut ? "#60a5fa" : "transparent",
            }}
          >
            {messageState.out}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={sendMessage} className="border px-2 py-1">
          ws message
        </button>
        <button
          className="border px-2 py-1 disabled:opacity-80"
          onClick={() => {
            const readyState = wsRef.current?.readyState;
            const timeout = readyState === WebSocket.CLOSED ? 0 : 1000;
            if (
              readyState === WebSocket.OPEN ||
              readyState === WebSocket.CONNECTING
            ) {
              wsRef.current?.close();
            }
            setTimeout(() => {
              wsRef.current = startWebSocket();
            }, timeout);
          }}
        >
          ws reconnect
        </button>
        <button
          className="border px-2 py-1"
          onClick={() => wsRef.current?.close()}
        >
          ws close
        </button>
      </div>
      <div>
        {mounted &&
          Array.from(cursors.values()).map(
            (session) =>
              props.id !== session.id && (
                <SvgCursor key={session.id} x={session.x} y={session.y} />
              ),
          )}
      </div>
    </>
  );
}

function getRandomHexColor() {
  const randomColor = Math.floor(Math.random() * 16777215).toString(16);
  return `#${randomColor.padStart(6, "0")}`;
}

function SvgCursor(props: { x: number; y: number }) {
  const [color] = useState(getRandomHexColor());

  return (
    <svg
      height="32"
      width="32"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={`absolute -top-[12px] -left-[12px] transition-transform duration-75 pointer-events-none ${props.x === -1 || props.y === -1 ? "hidden" : ""}`}
      style={{
        transform: `translate(${props.x * window.innerWidth}px, ${props.y * window.innerHeight}px)`,
      }}
    >
      <defs>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="1" dy="1" stdDeviation="1.2" floodOpacity="0.5" />
        </filter>
      </defs>
      <g fill="none" transform="rotate(0 16 16)" filter="url(#shadow)">
        <path
          d="M12 24.4219V8.4069L23.591 20.0259H16.81l-.411.124z"
          fill="white"
        />
        <path
          d="M21.0845 25.0962L17.4795 26.6312L12.7975 15.5422L16.4835 13.9892z"
          fill="white"
        />
        <path
          d="M19.751 24.4155L17.907 25.1895L14.807 17.8155L16.648 17.04z"
          fill={color}
        />
        <path
          d="M13 10.814V22.002L15.969 19.136l.428-.139h4.768z"
          fill={color}
        />
      </g>
    </svg>
  );
}
