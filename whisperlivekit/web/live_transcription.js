/* Theme, WebSocket, recording, rendering logic extracted from inline script and adapted for segmented theme control and WS caption */

let isRecording = false;
let websocket = null;
let recorder = null;
let chunkDuration = 100;
let websocketUrl = "ws://localhost:8000/asr";
let userClosing = false;
let wakeLock = null;
let startTime = null;
let timerInterval = null;
let audioContext = null;
let analyser = null;
let microphone = null;
let waveCanvas = document.getElementById("waveCanvas");
let waveCtx = waveCanvas.getContext("2d");
let animationFrame = null;
let waitingForStop = false;
let lastReceivedData = null;
let lastSignature = null;
let availableMicrophones = [];
let selectedMicrophoneId = null;
let selectedLanguage = "auto";

const LANGUAGES = {
    "en": "english",
    "zh": "chinese",
    "de": "german",
    "es": "spanish",
    "ru": "russian",
    "ko": "korean",
    "fr": "french",
    "ja": "japanese",
    "pt": "portuguese",
    "tr": "turkish",
    "pl": "polish",
    "ca": "catalan",
    "nl": "dutch",
    "ar": "arabic",
    "sv": "swedish",
    "it": "italian",
    "id": "indonesian",
    "hi": "hindi",
    "fi": "finnish",
    "vi": "vietnamese",
    "he": "hebrew",
    "uk": "ukrainian",
    "el": "greek",
    "ms": "malay",
    "cs": "czech",
    "ro": "romanian",
    "da": "danish",
    "hu": "hungarian",
    "ta": "tamil",
    "no": "norwegian",
    "th": "thai",
    "ur": "urdu",
    "hr": "croatian",
    "bg": "bulgarian",
    "lt": "lithuanian",
    "la": "latin",
    "mi": "maori",
    "ml": "malayalam",
    "cy": "welsh",
    "sk": "slovak",
    "te": "telugu",
    "fa": "persian",
    "lv": "latvian",
    "bn": "bengali",
    "sr": "serbian",
    "az": "azerbaijani",
    "sl": "slovenian",
    "kn": "kannada",
    "et": "estonian",
    "mk": "macedonian",
    "br": "breton",
    "eu": "basque",
    "is": "icelandic",
    "hy": "armenian",
    "ne": "nepali",
    "mn": "mongolian",
    "bs": "bosnian",
    "kk": "kazakh",
    "sq": "albanian",
    "sw": "swahili",
    "gl": "galician",
    "mr": "marathi",
    "pa": "punjabi",
    "si": "sinhala",
    "km": "khmer",
    "sn": "shona",
    "yo": "yoruba",
    "so": "somali",
    "af": "afrikaans",
    "oc": "occitan",
    "ka": "georgian",
    "be": "belarusian",
    "tg": "tajik",
    "sd": "sindhi",
    "gu": "gujarati",
    "am": "amharic",
    "yi": "yiddish",
    "lo": "lao",
    "uz": "uzbek",
    "fo": "faroese",
    "ht": "haitian creole",
    "ps": "pashto",
    "tk": "turkmen",
    "nn": "nynorsk",
    "mt": "maltese",
    "sa": "sanskrit",
    "lb": "luxembourgish",
    "my": "myanmar",
    "bo": "tibetan",
    "tl": "tagalog",
    "mg": "malagasy",
    "as": "assamese",
    "tt": "tatar",
    "haw": "hawaiian",
    "ln": "lingala",
    "ha": "hausa",
    "ba": "bashkir",
    "jw": "javanese",
    "su": "sundanese",
    "yue": "cantonese",
};

function populateLanguageSelect() {
    const languageSelect = document.getElementById("languageSelect");
    if (!languageSelect) return;

    for (const [code, name] of Object.entries(LANGUAGES)) {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        languageSelect.appendChild(option);
    }
}

waveCanvas.width = 60 * (window.devicePixelRatio || 1);
waveCanvas.height = 30 * (window.devicePixelRatio || 1);
waveCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

document.addEventListener('DOMContentLoaded', async () => {
  const statusText = document.getElementById("status");
  const recordButton = document.getElementById("recordButton");
  const chunkSelector = document.getElementById("chunkSelector");
  const websocketInput = document.getElementById("websocketInput");
  const websocketDefaultSpan = document.getElementById("wsDefaultUrl");
  const linesTranscriptDiv = document.getElementById("linesTranscript");
  const timerElement = document.querySelector(".timer");
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  const microphoneSelect = document.getElementById("microphoneSelect");
  const languageSelect = document.getElementById("languageSelect");
  const sourceRadios = document.querySelectorAll('input[name="input-source"]');
  const micSettings = document.getElementById("mic-settings");
  const hlsSettings = document.getElementById("hls-settings");
  const hlsUrlInput = document.getElementById("hlsUrlInput");

  // Default WebSocket URL computation
  const host = window.location.hostname || "localhost";
  const port = window.location.port;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const defaultWebSocketUrl = `${protocol}://${host}${port ? ":" + port : ""}/asr`;

  // Populate default caption and input
  if (websocketDefaultSpan) websocketDefaultSpan.textContent = defaultWebSocketUrl;
  websocketInput.value = defaultWebSocketUrl;
  websocketUrl = defaultWebSocketUrl;

  // Optional chunk selector (guard for presence)
  if (chunkSelector) {
    chunkSelector.addEventListener("change", () => {
      chunkDuration = parseInt(chunkSelector.value);
    });
  }

  // WebSocket input change handling
  if (websocketInput) {
      websocketInput.addEventListener("change", () => {
          const urlValue = websocketInput.value.trim();
          if (!urlValue.startsWith("ws://") && !urlValue.startsWith("wss://")) {
              statusText.textContent = "Invalid WebSocket URL (must start with ws:// or wss://)";
              return;
          }
          websocketUrl = urlValue;
          statusText.textContent = "WebSocket URL updated. Ready to connect.";
      });
  }
  recordButton.addEventListener("click", toggleRecording);

  if (microphoneSelect) {
    microphoneSelect.addEventListener("change", handleMicrophoneChange);
  }
  if (languageSelect) {
      languageSelect.addEventListener("change", handleLanguageChange);
  }
  try {
    await enumerateMicrophones();
    populateLanguageSelect();
  } catch (error) {
    console.log("Could not enumerate microphones on load:", error);
  }
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('Device change detected, re-enumerating microphones');
    try {
      await enumerateMicrophones();
    } catch (error) {
      console.log("Error re-enumerating microphones:", error);
    }
  });
  sourceRadios.forEach(radio => {
      radio.addEventListener('change', handleSourceChange);
  });
});

