
let SUBJECT_ID = "";
let REDO_ID = false;

const jsPsych = initJsPsych();

/* Load all possible trials*/
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(c => c.trim() !== ""))          // drop blank lines
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/*set up columns we'll need for data saving*/
const REQUIRED_COLUMNS = [
  "trial_id", "trial_type", "block_ID", "stim_type",
  "a_stim", "b_stim", "x_stim", "matched_label", "unmatched_label"
];

function asBool(v) {
  return /^(true|1|yes|t)$/i.test(String(v).trim());
}

async function loadTrials(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status} ${res.statusText})`);

  const rows = parseCSV(await res.text());
  if (!rows.length) throw new Error(`${url} has no trials in it.`);

  const missing = REQUIRED_COLUMNS.filter(c => !(c in rows[0]));
  if (missing.length) throw new Error(`${url} is missing column(s): ${missing.join(", ")}`);

  const seen = new Set();
  rows.forEach((r, i) => {
    if (seen.has(r.trial_id)) throw new Error(`Duplicate trial_id "${r.trial_id}" in ${url}`);
    seen.add(r.trial_id);
    if (!["practice", "experimental"].includes(r.trial_type)) {
      throw new Error(`Row ${i + 2}: trial_type must be "practice" or "experimental", got "${r.trial_type}"`);
    }
    ["a_stim", "b_stim", "x_stim"].forEach(c => {
      if (!r[c]) console.warn(`PiCS: row ${i + 2} (${r.trial_id}) has no ${c}.`);
    });
  });

  return rows.map(r => Object.assign({}, r, {
    block_ID: r.block_ID === "" ? null : Number(r.block_ID),
    force_matched: r.force_matched === "" ? undefined : asBool(r.force_matched)
  }));
}

/* randomize the non practice trials */
function balancedFlags(n, maxRun) {
  const nTrue = Math.floor(n / 2);
  const pool = Array.from({ length: n }, (_, i) => i < nTrue);
  for (let attempt = 0; attempt < 500; attempt++) {
    const shuffled = jsPsych.randomization.shuffle(pool);
    let run = 1, ok = true;
    for (let i = 1; i < shuffled.length; i++) {
      run = shuffled[i] === shuffled[i - 1] ? run + 1 : 1;
      if (run > maxRun) { ok = false; break; }
    }
    if (ok) return shuffled;
  }
  console.warn("PiCS: could not satisfy max_matched_run; using an unconstrained shuffle.");
  return jsPsych.randomization.shuffle(pool);
}

function buildRunList(bank) {
  const practice = bank.filter(t => t.trial_type === "practice");
  let experimental = bank.filter(t => t.trial_type === "experimental");

  if (CONFIG.RANDOMIZE.trial_order) {
    if (CONFIG.RANDOMIZE.avoid_category_run) {
      try {
        experimental = jsPsych.randomization.shuffleNoRepeats(
          experimental, (a, b) => a.stim_type === b.stim_type
        );
      } catch (e) {
        console.warn("PiCS: no-repeat shuffle failed, falling back to plain shuffle.", e);
        experimental = jsPsych.randomization.shuffle(experimental);
      }
    } else {
      experimental = jsPsych.randomization.shuffle(experimental);
    }
  }

  const flags = CONFIG.RANDOMIZE.matched_label
    ? balancedFlags(experimental.length, CONFIG.RANDOMIZE.max_matched_run)
    : experimental.map(() => true);

  const runList = [
    ...(CONFIG.SHUFFLE_PRACTICE ? jsPsych.randomization.shuffle(practice) : practice),
    ...experimental
  ];

  let expIdx = 0;
  return runList.map((t, i) => {
    const matched = t.trial_type === "practice"
      ? (t.force_matched !== undefined ? t.force_matched : true)
      : flags[expIdx++];

    return Object.assign({}, t, {
      run_order: i + 1,
      matched: matched,
      label: matched ? t.matched_label : t.unmatched_label,
      label_audio: matched ? t.matched_audio : t.unmatched_audio,
      b_side: CONFIG.RANDOMIZE.bx_side
        ? (Math.random() < 0.5 ? "left" : "right")
        : "left"
    });
  });
}

/* helper functions */

const stimPath = f => CONFIG.PATHS.stimuli + f;
function stimImg(file, cls = "") {
  return `<img class="stim ${cls}" src="${stimPath(file)}" alt="${file}"
            onerror="this.outerHTML='<div class=\\'stim stim-missing ${cls}\\'>${file}</div>'">`;
}

function showFatal(err) {
  document.body.innerHTML =
    `<div class="fatal">
       <div class="rsrch-kicker">Can't start</div>
       <p class="fatal-msg">${String(err.message || err)}</p>
       <p class="rsrch-note">Fix trials.csv and reload. Nothing was recorded.</p>
     </div>`;
  console.error(err);
}


const id_screen = {
  type: jsPsychSurveyHtmlForm,
  css_classes: ["researcher"],
  preamble: `<div class="rsrch-kicker">Researcher setup</div>
             <h1 class="rsrch-title">PiCS</h1>`,
  html: `<div class="field">
           <label for="subject_id">Participant ID</label>
           <input type="text" id="subject_id" name="subject_id"
                  autocomplete="off" autocapitalize="characters"
                  spellcheck="false" required>
         </div>`,
  autofocus: "subject_id",
  button_label: "Continue",
  data: { task: "id_entry" },
  on_finish: function (data) {
    SUBJECT_ID = String(data.response.subject_id).trim();
    jsPsych.data.addProperties({ subject_id: SUBJECT_ID });
  }
};

const start_and_intro = {
  type: jsPsychHtmlButtonResponse,
  css_classes: ["researcher"],
  stimulus: function () {
    return `
      <div id="rsrch-panel">
        <div class="rsrch-kicker">Confirm</div>
        <div class="id-readout">${SUBJECT_ID}</div>
        <p class="rsrch-note">Tap start, then hand the iPad to the child.</p>
        <div class="rsrch-actions">
          <button id="redo-btn" class="rsrch-btn rsrch-btn-alt">Re-enter ID</button>
          <button id="start-btn" class="rsrch-btn rsrch-btn-go">Start session</button>
        </div>
      </div>
      <div id="video-stage" class="video-wrap hidden">
        <video id="intro-vid" playsinline webkit-playsinline preload="auto"
               src="${CONFIG.PATHS.video + CONFIG.INTRO_VIDEO}"></video>
        ${CONFIG.RESEARCHER_SKIP ? '<button id="skip-vid" class="skip-btn">skip</button>' : ''}
      </div>`;
  },
  choices: ["Let's go!"],
  button_html: () => `<button id="go-btn" class="go-btn hidden">Let's go!</button>`,
  response_ends_trial: true,
  data: { task: "session_start" },
  on_load: function () {
    const panel = document.getElementById("rsrch-panel");
    const stage = document.getElementById("video-stage");
    const vid   = document.getElementById("intro-vid");
    const go    = document.getElementById("go-btn");
    const skip  = document.getElementById("skip-vid");

    const revealGo = () => {
      go.classList.remove("hidden");
      go.classList.add("pop");
    };

    document.getElementById("redo-btn").addEventListener("click", () => {
      REDO_ID = true;
      jsPsych.finishTrial({ task: "session_start", redo_id: true });
    });

    document.getElementById("start-btn").addEventListener("click", () => {
      REDO_ID = false;
      panel.classList.add("hidden");
      stage.classList.remove("hidden");
      vid.play();                    // inside the tap — this is the whole point
    });

    vid.addEventListener("ended", revealGo);
    vid.addEventListener("error", () => {
      console.warn("PiCS: intro video failed to load.");
      revealGo();
    });

    if (skip) skip.addEventListener("click", revealGo);
  }
};

const intake = {
  timeline: [id_screen, start_and_intro],
  loop_function: () => REDO_ID
};

/*To-Do: sample and sort trials*/
function trialData(t, task) {
  return {
    task: task,                                   // "sample" | "sort"
    trial_id: t.trial_id,                         // which trial (stable, from CSV)
    run_order: t.run_order,                       // where it landed (for this kid)
    collapsed_trial_num: t.run_order,             // actual trial number
    con_trial_num: (t.run_order - 1) * 2 + (task === "sample" ? 1 : 2),
    trial_type: t.trial_type,
    is_practice: t.trial_type === "practice",
    block_ID: t.block_ID,
    stim_type: t.stim_type,
    a_stim: t.a_stim, b_stim: t.b_stim, x_stim: t.x_stim,
    matched: t.matched,
    label: t.label,
    matched_label: t.matched_label,
    unmatched_label: t.unmatched_label,
    b_side: t.b_side
  };
}

function sampleTrial(t) {
  const left  = t.b_side === "left" ? t.b_stim : t.x_stim;
  const right = t.b_side === "left" ? t.x_stim : t.b_stim;

  return {
    type: jsPsychHtmlButtonResponse,
    css_classes: ["child", "task-screen"],
    stimulus: `
      <div class="target-row">${stimImg(t.a_stim, "target")}</div>
      <div class="label-plate">${t.label}</div>
    `,
    choices: [left, right],
    button_html: (choice) => `<button class="choice-btn">${stimImg(choice)}</button>`,
    data: trialData(t, "sample"),
    on_finish: function (data) {
      // Which competitor did the child choose to resolve?
      const chosenFile = data.response === 0 ? left : right;
      data.sampled = chosenFile === t.b_stim ? "B" : "X";
      data.sampled_stim = chosenFile;
    }
  };
}

function sortTrial(t) {
  return {
    type: jsPsychHtmlButtonResponse,
    css_classes: ["child", "task-screen"],
    stimulus: `
      <div class="label-plate">Which ones are the ${t.label}?</div>
      <div class="sort-row">
        ${stimImg(t.a_stim)}${stimImg(t.b_stim)}${stimImg(t.x_stim)}
      </div>
    `,
    choices: ["Done"],
    button_html: (choice) => `<button class="go-btn go-btn-small">${choice}</button>`,
    data: trialData(t, "sort")
  };
}

/* To-Do: Save data */

const save_node = {
  timeline: [{
    type: jsPsychPipe,
    action: "save",
    experiment_id: CONFIG.DATAPIPE_ID,
    filename: () => `${SUBJECT_ID || "noID"}_${Date.now()}.csv`,
    data_string: () => jsPsych.data.get().csv()
  }],
  conditional_function: () => CONFIG.DATAPIPE_ID !== null
};

const local_save_node = {
  timeline: [{
    type: jsPsychHtmlButtonResponse,
    css_classes: ["researcher"],
    stimulus: `<div class="rsrch-kicker">No DataPipe ID set</div>
               <p class="rsrch-note">Data was not uploaded. Download it instead.</p>`,
    choices: ["Download CSV"],
    button_html: (c) => `<button class="rsrch-btn rsrch-btn-go">${c}</button>`,
    on_finish: () => jsPsych.data.get().localSave("csv", `${SUBJECT_ID || "noID"}_${Date.now()}.csv`)
  }],
  conditional_function: () => CONFIG.DATAPIPE_ID === null
};

const done_screen = {
  type: jsPsychHtmlButtonResponse,
  css_classes: ["researcher"],
  stimulus: () => `<div class="rsrch-kicker">Session complete</div>
                   <div class="id-readout">${SUBJECT_ID}</div>
                   <p class="rsrch-note">Safe to close.</p>`,
  choices: [],
  trial_duration: null
};

/* Run! */

(async function main() {
  let bank;
  try {
    bank = await loadTrials(CONFIG.TRIAL_FILE);
  } catch (err) {
    showFatal(err);               // bad CSV fails here, not in front of a child
    return;
  }

  const runList = buildRunList(bank);

  jsPsych.data.addProperties({
    run_started: new Date().toISOString(),
    trial_file: CONFIG.TRIAL_FILE,
    n_trials: runList.length,
    user_agent: navigator.userAgent,
    screen_w: window.screen.width,
    screen_h: window.screen.height
  });

  const preload = {
    type: jsPsychPreload,
    video: [CONFIG.PATHS.video + CONFIG.INTRO_VIDEO],
    // Add stimuli/audio h:
    // images: runList.flatMap(t => [t.a_stim, t.b_stim, t.x_stim].map(stimPath)),
    // audio:  runList.flatMap(t => [t.a_audio, t.label_audio, t.transition_audio]
    //                              .map(f => CONFIG.PATHS.audio + f)),
    continue_after_error: true,
    message: `<p class="rsrch-note">Loading…</p>`,
    show_progress_bar: true
  };

  const timeline = [preload, intake];
  runList.forEach(t => {
    timeline.push(sampleTrial(t));
    timeline.push(sortTrial(t));
  });
  timeline.push(save_node, local_save_node, done_screen);

  jsPsych.run(timeline);
})();
