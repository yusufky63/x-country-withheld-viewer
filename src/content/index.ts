import { CHANNEL, isMarksMessage, isRequestMessage, type RequestMessage, type ResponseMessage } from "../bridge/message-schema";
import { readSettings } from "../core/settings";
import { Marker } from "./marker";

const marker = new Marker(document);

void readSettings().then(({ glowBorder, language }) => {
  marker.setGlow(glowBorder);
  marker.setLanguage(language);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.glowBorder) marker.setGlow(changes.glowBorder.newValue !== false);
  if (changes.language) marker.setLanguage(changes.language.newValue === "en" ? "en" : "tr");
});

async function relay({ requestId, request }: RequestMessage): Promise<void> {
  let response: unknown = null;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch {
    // The extension was reloaded under this page. X's own notices stay in place.
  }
  window.postMessage(
    { channel: CHANNEL, direction: "to-main", type: "response", requestId, response } satisfies ResponseMessage,
    location.origin,
  );
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data: unknown = event.data;
  if (isRequestMessage(data)) void relay(data);
  else if (isMarksMessage(data)) marker.add(data.applied, data.failed, data.profiles);
});
