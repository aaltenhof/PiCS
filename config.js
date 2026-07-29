/* ==========================================================================
   config.js — everything you'd want to change without touching task logic
   ========================================================================== */

const CONFIG = {

  // --- DataPipe ---------------------------------------------------------
  // Paste the experiment ID from your DataPipe dashboard here.
  // Leave as null while developing locally: data will be dumped to the
  // screen / console instead of being sent anywhere.
  DATAPIPE_ID: null,          // e.g. "aBcDeF123456"

  // --- Trial bank -------------------------------------------------------
  // Static CSV in the repo, fetched at page load. One row per trial.
  TRIAL_FILE: "trials.csv",

  // --- Media paths ------------------------------------------------------
  PATHS: {
    video:   "media/",
    stimuli: "media/stimuli/",
    audio:   "media/audio/"
  },

  INTRO_VIDEO: "intro_video.mp4",

  // --- Randomization ----------------------------------------------------
  RANDOMIZE: {
    trial_order:        true,   // shuffle experimental trials (sample+sort stay welded together)
    avoid_category_run: true,   // no two consecutive trials from the same stim_type
    matched_label:      true,   // assign matched/unmatched, balanced across trials
    max_matched_run:    2,      // no more than N matched (or unmatched) trials in a row
    bx_side:            true    // randomize left/right position of B vs X
  },

  // --- Practice ---------------------------------------------------------
  // Practice trials always run first, in the order given in trials.js.
  SHUFFLE_PRACTICE: false,

  // --- Debug ------------------------------------------------------------
  // Shows a small grey "skip" control on the video screen for the researcher.
  RESEARCHER_SKIP: true
};
