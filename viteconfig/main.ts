import { defineConfig } from "vite";

// YTVD: auto-updater hard-disabled for the fork until we have our own release pipeline.
// Flip back on by uncommenting this whole block AND changing YTMD_DISABLE_UPDATES below back to `devBuild`.
// import { execSync } from "node:child_process";
//
// let gitBranch: string = "";
// try {
//   gitBranch = execSync("git rev-parse --abbrev-ref HEAD").toString();
// } catch (e) {
//   // User has likely downloaded from the YTM Desktop via the "Download ZIP".
//   // We don't plan to support this, but at least provide users with a bit of improved UX
//   // by providing them with what to do rather than just leaving them in the dust.
//   e.message =
//     " ======= Failed to get Git Info. ======= \n" +
//     "Please make sure that when building this application you are cloning the repository from GitHub rather than using the Download ZIP option.\n" +
//     "Follow the instructions in the README.md file to clone the repository and build the application from there.\n" +
//     " ======= Failed to get Git Info. ======= \n\n" +
//     e.message;
//   // Re-throw the error so that the build fails with the updated message.
//   throw e;
// }
//
// // HEAD is used for production builds as they check out version tags in a detached HEAD state
// const devBuild = gitBranch !== "HEAD" && process.env.NODE_ENV === "development";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: ".vite/main",
    rollupOptions: {
      external: ["bufferutil", "utf-8-validate"]
    }
  },
  define: {
    // YTVD: auto-updater hard-disabled for the fork until our own release pipeline exists.
    // Flip back to `devBuild` once a publisher repo is set up via the YTMD_UPDATE_FEED_* env vars.
    YTMD_DISABLE_UPDATES: true,
    // Defaults intentionally left as the YTVD repo placeholder — must be overridden via env vars before any `npm run publish`.
    YTMD_UPDATE_FEED_OWNER: process.env.YTMD_UPDATE_FEED_OWNER ? `'${process.env.YTMD_UPDATE_FEED_OWNER}'` : "'ytvd-placeholder-owner'",
    YTMD_UPDATE_FEED_REPOSITORY: process.env.YTMD_UPDATE_FEED_REPOSITORY ? `'${process.env.YTMD_UPDATE_FEED_REPOSITORY}'` : "'ytvd-placeholder-repo'"
  }
});
