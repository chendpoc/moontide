import { mount } from "svelte";

import App from "./app/App.svelte";
import { DesktopController } from "$lib/controller/index.js";
import { createTauriBridge } from "$lib/bridge/tauriBridge.js";
import "../styles.css";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("MoonTide frontend root is missing");
}

const controller = new DesktopController(createTauriBridge());
mount(App, { target, props: { controller } });
