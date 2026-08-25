import { mount } from "svelte";

import App from "./App.svelte";
import { DesktopController } from "./controller";
import { createTauriBridge } from "./tauriBridge";
import "../styles.css";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("MoonTide frontend root is missing");
}

const controller = new DesktopController(createTauriBridge());
mount(App, { target, props: { controller } });
