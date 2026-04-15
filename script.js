

// 🔑 Firebase Config (ඔයාගේ එක දාන්න)
  apiKey: "AIzaSyAt9OJTiKpxaZrfhdB4NsdeHvK9LxjVVs8",
  authDomain: "vibrate-control.firebaseapp.com",
  databaseURL: "https://vibrate-control-default-rtdb.firebaseio.com",
  projectId: "vibrate-control",
  storageBucket: "vibrate-control.firebasestorage.app",
  messagingSenderId: "359718226120",
  appId: "1:359718226120:web:afa63eb4f2636a2dec3dfd",
  measurementId: "G-YY4M9RCH4H"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let blinkInterval = null;

// 🎚️ Speed control
const slider = document.getElementById("speedSlider");
const speedText = document.getElementById("speedValue");

let speed = slider.value;
speedText.innerText = speed;

// slider update
slider.oninput = function () {
  speed = this.value;
  speedText.innerText = speed;

  // Firebase update (real-time sync)
  db.ref("speed").set(speed);
};

// 🔘 Buttons (Controller)
function onVibrate() {
  db.ref("mode").set("on");
}

function offVibrate() {
  db.ref("mode").set("off");
}

function blinkVibrate() {
  db.ref("mode").set("blink");
}

// 📡 Receiver (Phone 2)
db.ref("mode").on("value", (snap) => {
  let mode = snap.val();

  // clear previous loop
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
  }

  if (mode === "on") {
    navigator.vibrate([500, 200, 500]);
  }

  else if (mode === "blink") {
    db.ref("speed").on("value", (s) => {
      speed = s.val() || 800;

      if (blinkInterval) clearInterval(blinkInterval);

      blinkInterval = setInterval(() => {
        navigator.vibrate(300); // 👉 300ms vibration (FAST ⚡)
      }, speed);
    });
  }

  else {
    navigator.vibrate(0);
  }
});