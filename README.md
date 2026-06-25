# Minimax GUI & Asset Pipeline

A desktop interface and automated asset pipeline for Windows designed to streamline workflows with the Minimax APIs. 

This project provides a complete graphical user interface (GUI) and structural wrapper around all currently available Minimax models. It eliminates the need for terminal-only operations, prevents the use of incompatible parameter combinations by dynamically exposing only supported settings, and automates downstream asset management tasks.

---

## ✨ Features

*   🖥️ **Graphical User Interface:** Full GUI-based asset generation replacing terminal commands.
*   🤖 **Model Compatibility:** Out-of-the-box support for all current Minimax API models.
*   📦 **Asset Management:** Integrated browsing, version comparison, and file organization.
*   🛠️ **Built-in Post-Processing:** Automated upscaling, background removal, and aspect-ratio cropping/trimming.
*   🔄 **Automation & Queue Control:** Reusable presets (style, mood, assets), batch generation, queue management with pause/resume functionality, and automatic retry/recovery for failed API calls.
*   🔒 **Privacy & Security:** Local execution. Assets and API keys remain on the local machine. Features an optional session-only key mode to avoid storing credentials between sessions.

---

## 🚀 Core Workflow: Automated Asset Production Pipeline

The core functionality of this tool revolves around an automated asset production pipeline that bridges the gap between game design documentation and bulk asset generation.

### Process Workflow:
1. **Template Export:** The tool exports a standardized handoff document template detailing all supported asset types and configurations.
2. **AI Specification:** This template, along with a Game Design Document (GDD), can be processed by a Large Language Model (LLM) to generate a structured asset specification file.
3. **Automated Batch Import:** Importing this specification file back into the tool automatically queues and configures multi-modal generation jobs (images, music, speech, and videos).

This system allows for hands-off, large-scale generation runs while ensuring all outputs automatically adhere to the predefined requirements (such as specific aspect ratios and model parameters).

---

## 🔧 Technical Details & Compatibility

*   **API Plans:** Optimized and tested for Minimax Token Subscription plans, allowing efficient quota utilization through structured batching. It is structurally compatible with Pay-As-You-Go (PAYG) accounts.
*   **Audio Pipeline:** Fully supports music and speech generation. Sound effect (SFX) pipelines are currently limited to manual extraction from longer generated audio tracks.

---

## 💬 Feedback & Contributions

Contributions and feedback regarding scalability bottlenecks, workflow optimizations, or feature comparisons with alternative generation pipelines are welcome via the Issues or Discussions tabs.

---

*Insert Screenshot / Animated GIF of the workflow here*
