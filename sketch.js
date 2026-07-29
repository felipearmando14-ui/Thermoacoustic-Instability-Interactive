
// Thermoacoustic Instability — Demo 1: The Resonator
//
// A combustion chamber's fundamental acoustic mode behaves, to first order,
// like a single damped harmonic oscillator: pluck it and it rings at its own
// natural pitch, then the ringing dies out. There is no heat release and no
// flame here — that arrives in Demo 2, which will reuse `chamber.step()` and
// simply add a heat-release drive term to pressureAcceleration.
//
// p5.js instance mode is used throughout so this sketch can later sit
// side-by-side with other demos on the same page.
// ============================================================================

const sketch = (p) => {

  // -------------------------------------------------------------------------
  // Tunable constants
  // -------------------------------------------------------------------------

  // SPEED_CONSTANT sets naturalFrequency = SPEED_CONSTANT / chamberLength.
  // Chosen (against the slider's 60-220 range) so the visible ringing sits
  // roughly between 0.8 Hz and 3 Hz -- a demo pace, not a physical one.
  const SPEED_CONSTANT = 180;

  // Small positive damping so a pluck rings for roughly 6-8 seconds before
  // settling back to rest.
  const DAMPING_COEFFICIENT = 0.6;

  // Fixed physics timestep. We take several small substeps per rendered
  // frame rather than one big step, which keeps the integrator stable even
  // at the higher end of the natural-frequency range.
  const TIME_STEP = 1 / 240;
  const SUBSTEPS_PER_FRAME = 4;

  // How far (in pressure units) the standing wave can be dragged, and how
  // many pixels of on-screen displacement correspond to one unit of pressure.
  const MAX_PRESSURE = 46;
  const PRESSURE_TO_PIXELS = 3.2;

  // Scrolling trace: fixed time window and fixed vertical scale.
  const TRACE_SECONDS = 7;
  const TRACE_MAX_PRESSURE = MAX_PRESSURE;

  // Chamber length is driven by the HTML slider; these mirror its min/max.
  const CHAMBER_LENGTH_MIN = 60;
  const CHAMBER_LENGTH_MAX = 220;

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  const CANVAS_WIDTH = 860;
  const CANVAS_HEIGHT = 520;

  const TUBE_CENTER_Y = 190;
  const TUBE_WALL_HEIGHT = 130;
  const TUBE_MIN_PIXEL_LENGTH = 260;
  const TUBE_MAX_PIXEL_LENGTH = 680;

  const TRACE_LEFT = 60;
  const TRACE_RIGHT = CANVAS_WIDTH - 60;
  const TRACE_TOP = 340;
  const TRACE_HEIGHT = 150;

  const COLOR_BACKGROUND = () => p.color('#f7f5f0');
  const COLOR_PANEL = () => p.color('#ffffff');
  const COLOR_INK = () => p.color('#23241f');
  const COLOR_INK_SOFT = () => p.color('#5b5d54');
  const COLOR_WALL = () => p.color('#3a3b34');
  const COLOR_WAVE_STROKE = () => p.color('#2b6fd9');
  const COLOR_WAVE_FILL = () => p.color(43, 111, 217, 55);
  const COLOR_ENVELOPE = () => p.color(43, 111, 217, 35);
  const COLOR_TRACE = () => p.color('#2b6fd9');
  const COLOR_ACCENT_WARM = () => p.color('#d9762b');

  // -------------------------------------------------------------------------
  // Chamber physics state
  //
  // Self-contained on purpose: Demo 2 can take this whole object, keep
  // step() as-is (or add a drive term to pressureAcceleration), and reuse
  // every rendering function below unchanged.
  // -------------------------------------------------------------------------

  const chamber = {
    pressure: 0,               // acoustic pressure -- how "swollen" the standing wave is right now
    pressureVelocity: 0,       // rate of change of pressure
    pressureAcceleration: 0,   // rate of change of pressureVelocity
    angularFrequency: 0,       // 2 * PI * naturalFrequency, updated each frame from chamberLength
    dampingCoefficient: DAMPING_COEFFICIENT,

    step(timeStep) {
      // Restoring force: the acoustic mode behaves like a spring, pulling
      // pressure back toward zero (rest) with a strength set by the
      // chamber's natural frequency.
      const restoringForce = -(this.angularFrequency * this.angularFrequency) * this.pressure;

      // Damping force: drains energy from the oscillation, proportional to
      // how fast pressure is currently changing. This is the only reason a
      // pluck ever dies out.
      const dampingForce = -2 * this.dampingCoefficient * this.pressureVelocity;

      this.pressureAcceleration = restoringForce + dampingForce;

      // Semi-implicit (symplectic) Euler: update velocity first, then use
      // the updated velocity to update position. More stable for an
      // oscillator than plain forward Euler.
      this.pressureVelocity += this.pressureAcceleration * timeStep;
      this.pressure += this.pressureVelocity * timeStep;
    }
  };

  // -------------------------------------------------------------------------
  // Demo state outside the physics object
  // -------------------------------------------------------------------------

  let chamberLength = 140;     // arbitrary units; drives both pitch and drawn tube length
  let naturalFrequency = 0;    // Hz, recomputed each frame from chamberLength

  let isBeingPlucked = false;
  let pressureHistory = [];    // fixed-length ring buffer for the scrolling trace

  let chamberLengthSlider, pluckButton;

  // -------------------------------------------------------------------------
  // p5 lifecycle
  // -------------------------------------------------------------------------

  p.setup = () => {
    const canvas = p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    canvas.parent('canvas-holder');

    const traceSampleCount = Math.round(TRACE_SECONDS * 60); // ~60 frames/sec
    pressureHistory = new Array(traceSampleCount).fill(0);

    chamberLengthSlider = p.select('#chamberLengthSlider');
    chamberLengthSlider.input(() => {
      chamberLength = Number(chamberLengthSlider.value());
    });
    chamberLength = Number(chamberLengthSlider.value());

    pluckButton = p.select('#pluckButton');
    pluckButton.mousePressed(triggerButtonPluck);
  };

  p.draw = () => {
    updateChamberFrequencyFromLength();

    if (!isBeingPlucked) {
      for (let substep = 0; substep < SUBSTEPS_PER_FRAME; substep++) {
        chamber.step(TIME_STEP);
      }
    }

    pressureHistory.push(chamber.pressure);
    pressureHistory.shift();

    updateCursor();

    p.background(COLOR_BACKGROUND());
    const tubeGeometry = getTubeGeometry();
    drawTube(tubeGeometry);
    drawStandingWave(tubeGeometry);
    drawFrequencyReadout();
    drawTracePanel();
  };

  p.mousePressed = () => {
    if (isMouseOverTube()) {
      isBeingPlucked = true;
      updatePressureFromMouse();
    }
  };

  p.mouseDragged = () => {
    if (isBeingPlucked) {
      updatePressureFromMouse();
    }
  };

  p.mouseReleased = () => {
    // Releasing does not reset anything -- the oscillator simply takes over
    // physics stepping again next frame, starting from wherever the drag
    // left pressure and with pressureVelocity = 0 (a clean pluck-and-let-go).
    isBeingPlucked = false;
  };

  // -------------------------------------------------------------------------
  // Physics-adjacent helpers (not rendering, not integration)
  // -------------------------------------------------------------------------

  function updateChamberFrequencyFromLength() {
    naturalFrequency = SPEED_CONSTANT / chamberLength;
    chamber.angularFrequency = 2 * p.PI * naturalFrequency;
  }

  function updatePressureFromMouse() {
    const verticalOffsetFromCenterline = p.mouseY - TUBE_CENTER_Y;
    const clampedOffset = p.constrain(
      verticalOffsetFromCenterline,
      -MAX_PRESSURE * PRESSURE_TO_PIXELS,
      MAX_PRESSURE * PRESSURE_TO_PIXELS
    );
    chamber.pressure = clampedOffset / PRESSURE_TO_PIXELS;
    chamber.pressureVelocity = 0; // frozen while held -- the drag IS the state, not a velocity
  }

  function triggerButtonPluck() {
    isBeingPlucked = false;
    chamber.pressure = MAX_PRESSURE * 0.7;
    chamber.pressureVelocity = 0;
  }

  // -------------------------------------------------------------------------
  // Geometry / hit-testing
  // -------------------------------------------------------------------------

  function getTubeGeometry() {
    const tubePixelLength = p.map(
      chamberLength,
      CHAMBER_LENGTH_MIN, CHAMBER_LENGTH_MAX,
      TUBE_MIN_PIXEL_LENGTH, TUBE_MAX_PIXEL_LENGTH
    );
    const tubeLeftX = CANVAS_WIDTH / 2 - tubePixelLength / 2;
    const tubeRightX = CANVAS_WIDTH / 2 + tubePixelLength / 2;
    return { tubePixelLength, tubeLeftX, tubeRightX };
  }

  function isMouseOverTube() {
    if (p.mouseY < 0 || p.mouseY > CANVAS_HEIGHT || p.mouseX < 0 || p.mouseX > CANVAS_WIDTH) {
      return false;
    }
    const { tubeLeftX, tubeRightX } = getTubeGeometry();
    const grabPadding = 20;
    const verticalReach = TUBE_WALL_HEIGHT / 2 + MAX_PRESSURE * PRESSURE_TO_PIXELS * 0.3 + grabPadding;
    return (
      p.mouseX >= tubeLeftX &&
      p.mouseX <= tubeRightX &&
      p.mouseY >= TUBE_CENTER_Y - verticalReach &&
      p.mouseY <= TUBE_CENTER_Y + verticalReach
    );
  }

  function updateCursor() {
    if (isBeingPlucked) {
      p.cursor('grabbing');
    } else if (isMouseOverTube()) {
      p.cursor('grab');
    } else {
      p.cursor(p.ARROW);
    }
  }

  // -------------------------------------------------------------------------
  // Rendering -- the chamber
  // -------------------------------------------------------------------------

  function drawTube(tubeGeometry) {
    const { tubeLeftX, tubeRightX } = tubeGeometry;

    // Static duct outline -- the physical container, independent of pressure.
    p.noFill();
    p.stroke(COLOR_INK_SOFT());
    p.strokeWeight(1.5);
    p.rectMode(p.CORNERS);
    p.rect(tubeLeftX, TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2, tubeRightX, TUBE_CENTER_Y + TUBE_WALL_HEIGHT / 2, 4);

    // End walls, drawn heavier so the chamber reads as closed at both ends.
    p.stroke(COLOR_WALL());
    p.strokeWeight(7);
    const wallOverhang = 14;
    p.line(tubeLeftX, TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2 - wallOverhang, tubeLeftX, TUBE_CENTER_Y + TUBE_WALL_HEIGHT / 2 + wallOverhang);
    p.line(tubeRightX, TUBE_CENTER_Y - TUBE_WALL_HEIGHT / 2 - wallOverhang, tubeRightX, TUBE_CENTER_Y + TUBE_WALL_HEIGHT / 2 + wallOverhang);

    p.strokeWeight(1);
  }

  function drawStandingWave(tubeGeometry) {
    const { tubeLeftX, tubeRightX, tubePixelLength } = tubeGeometry;

    drawHalfSineEnvelope(tubeLeftX, tubeRightX, tubePixelLength, MAX_PRESSURE, COLOR_ENVELOPE(), true);
    drawHalfSineEnvelope(tubeLeftX, tubeRightX, tubePixelLength, chamber.pressure, null, false);

    // Centerline -- the tube's rest position.
    p.stroke(COLOR_INK_SOFT());
    p.strokeWeight(1);
    p.drawingContext.setLineDash([4, 4]);
    p.line(tubeLeftX, TUBE_CENTER_Y, tubeRightX, TUBE_CENTER_Y);
    p.drawingContext.setLineDash([]);
  }

  // Draws the mirrored standing-wave shape for a given pressure amplitude.
  // The shape (a half-sine, zero at the walls, maximum at the middle) never
  // moves sideways -- only `pressureAmplitude` changes how far it swells.
  function drawHalfSineEnvelope(tubeLeftX, tubeRightX, tubePixelLength, pressureAmplitude, envelopeColor, isFaintEnvelope) {
    const sampleCount = 64;
    const upperPoints = [];
    const lowerPoints = [];

    for (let i = 0; i <= sampleCount; i++) {
      const normalizedPosition = i / sampleCount;           // 0 at left wall, 1 at right wall
      const modeShape = Math.sin(Math.PI * normalizedPosition); // 0 at both walls, 1 at center
      const displacementPixels = pressureAmplitude * PRESSURE_TO_PIXELS * modeShape;
      const x = tubeLeftX + normalizedPosition * tubePixelLength;
      upperPoints.push({ x, y: TUBE_CENTER_Y - displacementPixels });
      lowerPoints.push({ x, y: TUBE_CENTER_Y + displacementPixels });
    }

    if (isFaintEnvelope) {
      p.noFill();
      p.stroke(envelopeColor);
      p.strokeWeight(1);
      p.drawingContext.setLineDash([3, 5]);
      drawPolyline(upperPoints);
      drawPolyline(lowerPoints);
      p.drawingContext.setLineDash([]);
      return;
    }

    // Live wave: filled lens between the upper and lower curves.
    p.noStroke();
    p.fill(COLOR_WAVE_FILL());
    p.beginShape();
    for (const point of upperPoints) p.vertex(point.x, point.y);
    for (let i = lowerPoints.length - 1; i >= 0; i--) p.vertex(lowerPoints[i].x, lowerPoints[i].y);
    p.endShape(p.CLOSE);

    p.noFill();
    p.stroke(COLOR_WAVE_STROKE());
    p.strokeWeight(2);
    drawPolyline(upperPoints);
    drawPolyline(lowerPoints);
  }

  function drawPolyline(points) {
    p.beginShape();
    for (const point of points) p.vertex(point.x, point.y);
    p.endShape();
  }

  function drawFrequencyReadout() {
    p.noStroke();
    p.fill(COLOR_INK());
    p.textFont('Helvetica');
    p.textSize(13);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(`Natural pitch: ${naturalFrequency.toFixed(2)} Hz`, CANVAS_WIDTH - 12, 12);
    p.textAlign(p.LEFT, p.TOP);
    p.fill(COLOR_INK_SOFT());
    p.text('Drag the tube up or down to pluck it', 12, 12);
  }

  // -------------------------------------------------------------------------
  // Rendering -- the scrolling trace
  // -------------------------------------------------------------------------

  function drawTracePanel() {
    p.rectMode(p.CORNER); // drawTube() leaves rectMode set to CORNERS
    p.noStroke();
    p.fill(COLOR_PANEL());
    p.rect(TRACE_LEFT - 20, TRACE_TOP - 24, (TRACE_RIGHT - TRACE_LEFT) + 40, TRACE_HEIGHT + 44, 6);

    p.fill(COLOR_INK_SOFT());
    p.textSize(12);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(`pressure vs. time  (last ${TRACE_SECONDS}s)`, TRACE_LEFT - 10, TRACE_TOP - 8);

    const zeroY = mapPressureToTraceY(0);
    p.stroke(220);
    p.strokeWeight(1);
    p.line(TRACE_LEFT, zeroY, TRACE_RIGHT, zeroY);

    p.noFill();
    p.stroke(COLOR_TRACE());
    p.strokeWeight(2);
    p.beginShape();
    for (let i = 0; i < pressureHistory.length; i++) {
      const x = p.map(i, 0, pressureHistory.length - 1, TRACE_LEFT, TRACE_RIGHT);
      const y = mapPressureToTraceY(pressureHistory[i]);
      p.vertex(x, y);
    }
    p.endShape();

    // Marker at the current (rightmost) sample.
    p.noStroke();
    p.fill(COLOR_ACCENT_WARM());
    const lastY = mapPressureToTraceY(pressureHistory[pressureHistory.length - 1]);
    p.circle(TRACE_RIGHT, lastY, 6);
  }

  function mapPressureToTraceY(pressureValue) {
    return p.map(pressureValue, -TRACE_MAX_PRESSURE, TRACE_MAX_PRESSURE, TRACE_TOP + TRACE_HEIGHT, TRACE_TOP);
  }
};

new p5(sketch);
