# Patent Disclosure Overview: MyoHurdle Protocol

## 1. Title of Invention
**MyoHurdle Protocol: Gamified EMG Biofeedback System for Neuromuscular Training and Rehabilitation**

## 2. Field of the Invention
The present invention relates generally to medical devices, physical rehabilitation, and biofeedback systems. More specifically, it relates to an interactive, gamified software and hardware system that utilizes real-time Electromyography (EMG) signals to drive motor training protocols and assess muscular performance.

## 3. Background
Traditional physical therapy and motor training often suffer from a lack of objective, real-time feedback and low patient engagement. While clinical EMG systems exist, they are primarily diagnostic and lack interactive, gamified elements that encourage patient compliance. Existing "exergaming" systems often rely on gross motor movements (via cameras or accelerometers) rather than direct neurological activation (EMG), making them unsuitable for specific localized muscle rehabilitation or for patients with limited mobility but intact neural pathways.

## 4. Summary of the Invention
The **MyoHurdle Protocol** is a novel system that translates real-time muscular electrical activity (EMG) into game mechanics. Users attach surface EMG electrodes to target muscles (e.g., legs, arms). The system records baseline resting activity and a calibrated "target strength" (threshold). During the protocol, users are presented with a series of digital "hurdles." To clear a hurdle, the user must contract the targeted muscle(s) past the dynamic threshold within a strict time limit. 

The system operates entirely via web technologies (Web Serial API) for immediate accessibility, communicating with an ESP32-based hardware module to process high-frequency raw EMG signals into actionable game control metrics (Root Mean Square / RMS).

## 5. Key Novel Features (Patentable Aspects)

*   **Dynamic, Patient-Specific Calibration:** The system automatically establishes a baseline resting threshold (Phase 1) and an active flex threshold (Phase 2), ensuring the game adapts to the specific strength and fatigue level of the individual user at the start of every session.
*   **Multi-Muscle Control Logic:** The system can combine inputs from multiple muscle groups (e.g., Rectus Femoris + Biceps Femoris) using distinct logical modes to control a single game action:
    *   *Average RMS:* Smooths combined effort across muscles.
    *   *Max RMS:* Action occurs if *any* muscle exceeds the threshold.
    *   *Min RMS (Simultaneous Activation):* Action *only* occurs if *all* targeted muscles cross the threshold simultaneously, training complex motor coordination.
*   **Precision Reaction & Efficiency Analytics:** The system logs microsecond-level data for every hurdle attempt, calculating "Time-to-act" (reaction time to visual stimulus) and "Efficiency" (the shape and duration of the muscle contraction compared to the target threshold).
*   **Browser-Based Acquisition and Rendering:** By utilizing the Web Serial API combined with a localized EMG processing engine, the system eliminates the need for standalone backend software (e.g., Python), making it a zero-install, highly portable clinical tool.

## 6. System Architecture
1.  **Hardware:** Surface EMG sensors connected to an embedded microcontroller (ESP32) transmitting raw signal data at high baud rates.
2.  **Web Serial Interface:** Browser-based module that receives, parses, and error-checks the incoming data stream in real-time.
3.  **Signal Processing Engine:** Applies digital noise filters (e.g., bandpass 20-450Hz, 50/60Hz notch) and calculates Root Mean Square (RMS) and peak-to-peak voltage dynamically.
4.  **Game UI / Logic:** Renders the "Hurdle" interface, manages countdowns, registers threshold crossings, and provides immediate visual feedback.
5.  **Analytics Module:** Compiles trial data into structured session formats (JSON/CSV) detailing attempt counts, clearing times, and peak EMG values.

## 7. Commercial Applications and Use Cases
*   **Clinical Rehabilitation:** Stroke recovery, post-surgical physical therapy, and treatment of neuromuscular disorders (e.g., cerebral palsy).
*   **Sports Science:** Athletic conditioning, muscle imbalance correction, and targeted hypertrophy training.
*   **Neuroprosthetics:** Training users to isolate and control specific muscle groups prior to fitting myoelectric prosthetic limbs.
