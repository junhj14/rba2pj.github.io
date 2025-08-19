import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
#!/usr/bin/env python3
import time, json, math, uuid, ssl, threading, hashlib
from pathlib import Path
import cv2
import numpy as np
from ultralytics import YOLO
import paho.mqtt.client as mqtt

# ===== 동작 정책 =====
VERDICT_PUBLISH_MODE = "once"

# ===== YOLO/RealSense 설정 =====
MODEL_PATH = "C:/Users/my/Desktop/rokey/rba2pj/template-dashboard-oss/src/app/(main)/details/yolo/realpcb.pt"

RS_WIDTH   = 1280
RS_HEIGHT  = 720
RS_FPS     = 30
CONF_THRES = 0.5
IMG_SIZE   = 640

# 라벨명(네 모델과 일치)
CABLE_CLASS_NAME = "cable"
TWO_PIN_TYPES = {"resistor","capacitor","switch","led","transistor"}

# ===== 색상 매핑(BGR) =====
COLOR_BY_TYPE = {
    "resistor":   (0, 255, 255),  # 노랑
    "capacitor":  (255, 0, 0),    # 파랑
    "switch":     (0, 255, 0),    # 초록
    "led":        (0, 0, 255),    # 빨강
    "transistor": (255, 0, 255),  # 보라(마젠타)
}
def comp_color(t: str):
    return COLOR_BY_TYPE.get(t.lower(), (0, 255, 0))  # 기본: 초록

# ===== MQTT 설정 =====
MQTT_HOST = "g11c1e1e.ala.eu-central-1.emqxsl.com"
MQTT_PORT = 8883
MQTT_USERNAME = "okj1812"
MQTT_PASSWORD = "okj1812"

SUB_TOPIC   = "llm/action"
CHECK_TOPIC = "check"
PUB_TOPIC   = SUB_TOPIC
MQTT_QOS    = 1
CLIENT_ID   = f"tts-linux-sel-{uuid.uuid4().hex[:8]}"

# ===== RealSense 래퍼 =====
try:
    import pyrealsense2 as rs
except Exception as e:
    raise RuntimeError("pyrealsense2 필요: pip install pyrealsense2") from e

class RealSenseCapture:
    def __init__(self, width=RS_WIDTH, height=RS_HEIGHT, fps=RS_FPS, use_align=False):
        self.pipeline = rs.pipeline()
        self.config = rs.config()
        self.config.enable_device("207222073252")
        self.config.enable_stream(rs.stream.color, width, height, rs.format.rgb8, fps)
        self.align = None
        try:
            self.profile = self.pipeline.start(self.config)
        except Exception:
            self.config.disable_all_streams()
            self.config.enable_stream(rs.stream.color, 640, 480, rs.format.rgb8, 30)
            time.sleep(0.2)
            self.profile = self.pipeline.start(self.config)
        try:
            vs = self.profile.get_stream(rs.stream.color).as_video_stream_profile()
            self.intrinsics = vs.get_intrinsics()
        except Exception:
            self.intrinsics = None
        self.running = True

    def read(self, timeout_ms=5000):
        if not self.running:
            return False, None
        frames = self.pipeline.wait_for_frames(timeout_ms)
        color = frames.get_color_frame()
        if not color:
            return False, None
        frame_rgb = np.asanyarray(color.get_data())
        frame = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
        return True, frame

    def release(self):
        if self.running:
            try: self.pipeline.stop()
            except Exception: pass
            self.running = False

# ===== 설계 상태 공유 =====
spec_lock = threading.Lock()
spec_state = {
    "ready": False,
    "raw": None,
    "components": None,
    "edges": None,
    "type_to_refs": None,
    "job_id": None,
    "spec_hash": None,
    "received_ts": None,
}

def _hash_spec(raw_obj: dict) -> str:
    try:
        b = json.dumps(raw_obj, sort_keys=True, separators=(",",":")).encode("utf-8")
        return hashlib.sha256(b).hexdigest()[:16]
    except Exception:
        return None

def _make_edges_set(edges_list):
    return set(tuple(sorted(pair)) for pair in edges_list)

def _build_type_to_refs(components):
    d = {}
    for c in components:
        t = c["type"].lower()
        d.setdefault(t, []).append(c["ref"])
    return d

def accept_spec_from_payload(payload: dict) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("event") == "pcb_judgement":
        return False
    if "components" not in payload or "edges" not in payload:
        return False

    comps_in = payload.get("components")
    edges_in = payload.get("edges")
    if not isinstance(comps_in, list) or not isinstance(edges_in, list):
        return False

    comps = []
    refs = set()
    for c in comps_in:
        if not isinstance(c, dict): continue
        ref = c.get("ref"); typ = c.get("type")
        if not ref or not typ: continue
        comps.append({"ref": str(ref), "type": str(typ).lower()})
        refs.add(str(ref))

    edges_clean = []
    for e in edges_in:
        if (isinstance(e, (list, tuple)) and len(e) == 2
            and str(e[0]) in refs and str(e[1]) in refs
            and str(e[0]) != str(e[1])):
            edges_clean.append([str(e[0]), str(e[1])])

    if not comps or not edges_clean:
        return False

    with spec_lock:
        spec_state["raw"] = {
            "schema": payload.get("schema", "v1"),
            "components": comps_in,
            "edges": edges_in
        }
        spec_state["components"]   = comps
        spec_state["edges"]        = _make_edges_set(edges_clean)
        spec_state["type_to_refs"] = _build_type_to_refs(comps)
        spec_state["job_id"]       = payload.get("job_id")
        spec_state["spec_hash"]    = _hash_spec(spec_state["raw"])
        spec_state["received_ts"]  = time.strftime("%Y%m%d_%H%M%S")
        spec_state["ready"]        = True
    print(f"[MQTT] Spec accepted: {len(comps)} comps, {len(edges_clean)} edges, "
          f"job_id={spec_state['job_id']}, hash={spec_state['spec_hash']}")
    return True

# ===== MQTT =====
def mqtt_connect():
    client = mqtt.Client(client_id=CLIENT_ID, clean_session=True, protocol=mqtt.MQTTv311)
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    client.tls_insecure_set(False)

    def on_connect(c, u, flags, rc, properties=None):
        print(f"[MQTT] connected rc={rc}")
        c.subscribe([(SUB_TOPIC, MQTT_QOS), (CHECK_TOPIC, MQTT_QOS)])
        print(f"[MQTT] subscribed → {SUB_TOPIC}, {CHECK_TOPIC}")

    def on_message(c, u, msg):
        print(f"[MQTT] message on '{msg.topic}'")
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except Exception as e:
            print(f"[MQTT] bad JSON: {e}")
            return
        if accept_spec_from_payload(payload):
            with spec_lock:
                ack = {
                    "event": "spec_ack",
                    "client_id": CLIENT_ID,
                    "timestamp": time.strftime("%Y%m%d_%H%M%S"),
                    "job_id": spec_state.get("job_id"),
                    "spec_hash": spec_state.get("spec_hash"),
                    "status": "READY",
                    "source_topic": msg.topic,
                }
            c.publish(PUB_TOPIC, json.dumps(ack, ensure_ascii=False), qos=MQTT_QOS, retain=False)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()
    return client

def mqtt_publish_json(client, topic, payload, qos=MQTT_QOS, retain=False):
    s = json.dumps(payload, ensure_ascii=False)
    return client.publish(topic, s, qos=qos, retain=retain)

# ===== YOLO 유틸 =====
def yolo_detections(result, conf_thres, names):
    dets = []
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return dets
    for i in range(len(boxes)):
        conf = float(boxes.conf[i].item()) if boxes.conf is not None else 0.0
        if conf < conf_thres: continue
        cls_id = int(boxes.cls[i].item()) if boxes.cls is not None else -1
        cls_name = names[cls_id] if isinstance(names, (list,tuple)) else (names.get(cls_id, str(cls_id)))
        x1,y1,x2,y2 = map(int, boxes.xyxy[i].tolist())
        dets.append((cls_name.lower(), conf, (x1,y1,x2,y2)))
    return dets

def estimate_two_pins_from_box(x1,y1,x2,y2):
    w, h = (x2-x1), (y2-y1)
    if w >= h:
        cy = int((y1+y2)/2); return (x1, cy), (x2, cy)
    else:
        cx = int((x1+x2)/2); return (cx, y1), (cx, y2)

# ---- cable crop에서 스켈레톤 + 직선화(예쁘게) 끝점 찾기 ----
def cable_endpoints_from_crop(crop_bgr):
    h, w = crop_bgr.shape[:2]
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 5, 25, 25)
    gray = cv2.equalizeHist(gray)
    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)), 1)

    # 얇게(스켈레톤) 만들기
    skel = np.zeros_like(edges)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3,3))
    tmp = edges.copy()
    while True:
        opened = cv2.morphologyEx(tmp, cv2.MORPH_OPEN, element)
        sub = cv2.subtract(tmp, opened)
        eroded = cv2.erode(tmp, element)
        skel = cv2.bitwise_or(skel, sub); tmp = eroded
        if cv2.countNonZero(tmp) == 0: break

    ys, xs = np.where(skel > 0)
    if xs.size >= 20:
        pts = np.column_stack((xs, ys)).astype(np.float32)
        vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_L2, 0, 0.01, 0.01).flatten()
        v = np.array([vx, vy], dtype=np.float32)
        p0 = np.array([x0, y0], dtype=np.float32)
        t = (pts - p0) @ v
        tmin, tmax = float(t.min()), float(t.max())
        p1 = p0 + v * tmin
        p2 = p0 + v * tmax
        p1 = (int(np.clip(p1[0], 0, w-1)), int(np.clip(p1[1], 0, h-1)))
        p2 = (int(np.clip(p2[0], 0, w-1)), int(np.clip(p2[1], 0, h-1)))
        return [p1, p2]

    p1, p2 = estimate_two_pins_from_box(0,0,w,h)
    return [p1, p2]

def build_component_and_cable_lists(dets, frame_bgr):
    H, W = frame_bgr.shape[:2]
    components, cables = [], []
    type_counts = {}
    for (t, conf, (x1,y1,x2,y2)) in dets:
        if t == CABLE_CLASS_NAME:
            x1c, y1c, x2c, y2c = max(0,x1), max(0,y1), min(W,x2), min(H,y2)
            crop = frame_bgr[y1c:y2c, x1c:x2c]
            ends_local = cable_endpoints_from_crop(crop)
            ends = [(x1c + ex, y1c + ey) for (ex,ey) in ends_local]
            type_counts[t] = type_counts.get(t,0)+1
            ref = f"CAB{type_counts[t]}"
            cables.append({"ref": ref, "ends": ends, "bbox":[x1,y1,x2,y2]})
        else:
            type_counts[t] = type_counts.get(t,0)+1
            ref = f"{t.upper()}{type_counts[t]}"
            components.append({"ref": ref, "type": t, "bbox":[x1,y1,x2,y2]})
    return components, cables

def map_refs_by_type(spec_type_to_refs, detected_components):
    type_to_detected = {}
    for c in detected_components:
        t = c["type"].lower()
        x1,y1,x2,y2 = c["bbox"]
        cx = (x1+x2)/2.0
        type_to_detected.setdefault(t, []).append((cx, c["ref"]))
    for t in type_to_detected:
        type_to_detected[t].sort(key=lambda x: x[0])

    det2spec = {}
    for t, spec_refs in (spec_type_to_refs or {}).items():
        det_list = type_to_detected.get(t, [])
        if len(det_list) != len(spec_refs):
            continue
        for (_, det_ref), spec_ref in zip(det_list, spec_refs):
            det2spec[det_ref] = spec_ref
    return det2spec

def build_pins_by_ref(components):
    pins_by_ref = {}
    for c in components:
        ref = c["ref"]; t = c["type"].lower()
        x1,y1,x2,y2 = c["bbox"]
        if t in TWO_PIN_TYPES:
            p1,p2 = estimate_two_pins_from_box(x1,y1,x2,y2)
            pins_by_ref[ref] = [p1,p2]
        else:
            cx, cy = int((x1+x2)/2), int((y1+y2)/2)
            pins_by_ref[ref] = [(cx,cy)]
    return pins_by_ref

def nearest_component(pt, components):
    x,y = pt
    best = (None, float("inf"))
    for c in components:
        x1,y1,x2,y2 = c["bbox"]
        dx = max(x1 - x, 0, x - x2)
        dy = max(y1 - y, 0, y - y2)
        d = math.hypot(dx, dy)
        if d < best[1]:
            best = (c["ref"], d)
    return best

def snap_cables_to_components(components, cables, r_snap=18.0):
    pins_by_ref = build_pins_by_ref(components)
    edges, details = [], []
    for cab in cables:
        a,b = cab["ends"]
        def nearest_pin(pt):
            best = (None, None, float("inf"))
            for ref, pin_list in pins_by_ref.items():
                for i, (px,py) in enumerate(pin_list):
                    d = math.hypot(px-pt[0], py-pt[1])
                    if d < best[2]:
                        best = (ref, i, d)
            return best
        Aref, Api, Ad = nearest_pin(a)
        Bref, Bpi, Bd = nearest_pin(b)
        if Aref is None or Ad > r_snap:
            Aref, Ad = nearest_component(a, components); Api = None
        if Bref is None or Bd > r_snap:
            Bref, Bd = nearest_component(b, components); Bpi = None

        info = {"cable": cab["ref"],
                "A":{"pt":a, "to_ref":Aref, "pin":Api, "dist":round(Ad,2) if Ad is not None else None},
                "B":{"pt":b, "to_ref":Bref, "pin":Bpi, "dist":round(Bd,2) if Bd is not None else None},
                "issues":[]}
        if Aref is None or Ad is None: info["issues"].append("OPEN_A")
        if Bref is None or Bd is None: info["issues"].append("OPEN_B")
        if Aref and Bref and Aref == Bref: info["issues"].append("WRONG_SAME_COMPONENT")
        if Aref and Bref and Aref != Bref:
            edges.append(tuple(sorted([Aref, Bref])))
        details.append(info)
    return set(edges), details

def compare_graphs(spec_edges:set, measured_edges:set):
    missing = sorted(list(spec_edges - measured_edges))
    extra   = sorted(list(measured_edges - spec_edges))
    ok      = sorted(list(spec_edges & measured_edges))
    verdict = "PASS" if (not missing and not extra) else "FAIL"
    return {"verdict": verdict, "ok": ok, "missing": missing, "extra": extra}

# ---- 보기 좋게 선/끝점 그리는 헬퍼 ----
def draw_pretty_line(img, p1, p2, inner=(245,245,245), outer=(40,40,40)):
    cv2.line(img, p1, p2, outer, 4, cv2.LINE_AA)
    cv2.line(img, p1, p2, inner, 2, cv2.LINE_AA)

def draw_endpoint(img, p, inner=(255,255,255), outer=(0,0,0)):
    p = tuple(map(int, p))
    cv2.circle(img, p, 6, outer, -1, cv2.LINE_AA)  # 바깥
    cv2.circle(img, p, 4, inner, -1, cv2.LINE_AA)  # 안쪽

def draw_overlay(frame, components, cables, measured_edges, mapping):
    vis = frame.copy()

    # 1) 케이블: 선 + 끝점 먼저(뒤 레이어)
    for cab in cables:
        if len(cab["ends"]) >= 2:
            p1 = tuple(map(int, cab["ends"][0]))
            p2 = tuple(map(int, cab["ends"][1]))
            draw_pretty_line(vis, p1, p2)
            draw_endpoint(vis, p1)
            draw_endpoint(vis, p2)

    # 2) 컴포넌트 bbox/라벨을 나중에(앞 레이어)
    for c in components:
        x1,y1,x2,y2 = c["bbox"]
        det_ref = c["ref"]; spec_ref = mapping.get(det_ref, det_ref)
        col = comp_color(c["type"])
        cv2.rectangle(vis, (x1,y1), (x2,y2), col, 2)
        org = (x1, max(0, y1-8))
        cv2.putText(vis, f"{spec_ref}", org, cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,0,0), 3, cv2.LINE_AA)
        cv2.putText(vis, f"{spec_ref}", org, cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 1, cv2.LINE_AA)

    # 3) 스펙 기준 연결선(중심-중심)은 최상층(원래대로)
    for (a,b) in measured_edges:
        def center_of(ref_name):
            inv = {v:k for k,v in mapping.items()}
            det = inv.get(ref_name, ref_name)
            for c in components:
                if c["ref"] == det:
                    x1,y1,x2,y2 = c["bbox"]
                    return (int((x1+x2)/2), int((y1+y2)/2))
            return None
        pa, pb = center_of(a), center_of(b)
        if pa and pb:
            cv2.line(vis, pa, pb, (255,0,0), 2, cv2.LINE_AA)
    return vis

# ===== 메인 =====
def main():
    mqtt_client = mqtt_connect()

    cap = RealSenseCapture(RS_WIDTH, RS_HEIGHT, RS_FPS, use_align=False)
    model = YOLO(str(MODEL_PATH))

    save_dir = Path("captures"); save_dir.mkdir(parents=True, exist_ok=True)
    out_dir  = Path("snapshots"); out_dir.mkdir(parents=True, exist_ok=True)

    conf = float(CONF_THRES); imgsz = int(IMG_SIZE)
    win = "YOLO Checker (RealSense + MQTT Spec)"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    print("[INFO] 준비: MQTT로 설계(JSON) 수신 → Spec: READY")
    print("키: p(촬영/판정)  [ / ](conf)  s(저장)  ESC(종료)")

    t_prev, fps = time.time(), 0.0
    published_once = False
    last_sent_verdict = None

    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            print("[WARN] RealSense 프레임을 받지 못했습니다."); break

        with spec_lock:
            spec_ready = bool(spec_state["ready"])
            spec_edges = spec_state["edges"]
            spec_type_to_refs = spec_state["type_to_refs"]
            cur_job_id = spec_state["job_id"]
            cur_spec_hash = spec_state["spec_hash"]

        results = model(frame, conf=conf, imgsz=imgsz, verbose=False)
        r = results[0]
        names = r.names

        # YOLO 기본 bbox/라벨은 숨기고, 직접 그리기
        annotated = frame.copy()

        # 디텍트 → 컴포넌트/케이블 분리
        dets = yolo_detections(r, conf, names)
        components_live, cables_live = build_component_and_cable_lists(dets, frame)

        # 1) 케이블: 선 + 끝점(뒤 레이어)
        for cab in cables_live:
            if len(cab["ends"]) >= 2:
                p1 = tuple(map(int, cab["ends"][0]))
                p2 = tuple(map(int, cab["ends"][1]))
                draw_pretty_line(annotated, p1, p2)
                draw_endpoint(annotated, p1)
                draw_endpoint(annotated, p2)

        # 2) 컴포넌트 bbox/라벨(앞 레이어)
        for comp in components_live:
            x1,y1,x2,y2 = comp["bbox"]
            col = comp_color(comp["type"])
            cv2.rectangle(annotated, (x1,y1), (x2,y2), col, 2)
            org = (x1, max(0, y1-8))
            cv2.putText(annotated, comp["ref"], org, cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,0,0), 3, cv2.LINE_AA)
            cv2.putText(annotated, comp["ref"], org, cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 1, cv2.LINE_AA)

        # HUD
        now = time.time()
        dt = now - t_prev
        if dt > 0: fps = 0.9*fps + 0.1*(1.0/dt)
        t_prev = now
        status = "READY" if spec_ready else "WAIT_SPEC"
        cv2.putText(annotated, f"conf={conf:.2f} FPS={fps:.1f}  Spec:{status}",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,255,0), 2, cv2.LINE_AA)
        if cur_spec_hash:
            cv2.putText(annotated, f"spec_hash:{cur_spec_hash}", (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200,200,0), 2, cv2.LINE_AA)

        cv2.imshow(win, annotated)

        k = cv2.waitKey(1) & 0xFF
        if k == 27:
            break
        elif k == ord('['):
            conf = max(0.0, round(conf - 0.05, 2)); print(f"[INFO] conf → {conf:.2f}")
        elif k == ord(']'):
            conf = min(1.0, round(conf + 0.05, 2)); print(f"[INFO] conf → {conf:.2f}")
        elif k == ord('s'):
            ts = time.strftime("%Y%m%d_%H%M%S")
            out = save_dir / f"frame_{ts}.png"
            cv2.imwrite(str(out), annotated); print(f"[SAVED] {out}")
        elif k == ord('p'):
            if not spec_ready:
                print("[INFO] 아직 설계를 받지 못했습니다. MQTT로 spec JSON을 먼저 보내주세요.")
                continue

            ts = time.strftime("%Y%m%d_%H%M%S")
            # 판정용 계산(저장 이미지도 동일한 레이어 순서 적용)
            dets_p = yolo_detections(r, conf, names)
            components, cables = build_component_and_cable_lists(dets_p, frame)

            det2spec = map_refs_by_type(spec_type_to_refs, components)
            measured_edges_det, cable_attach = snap_cables_to_components(components, cables, r_snap=18.0)

            def to_spec_edge(edge):
                a,b = edge
                return tuple(sorted([det2spec.get(a,a), det2spec.get(b,b)]))
            measured_edges_spec = set(to_spec_edge(e) for e in measured_edges_det)

            cmp_report = compare_graphs(spec_edges, measured_edges_spec)
            print("[REPORT]", cmp_report["verdict"])
            if cmp_report["missing"]: print("  MISSING:", cmp_report["missing"])
            if cmp_report["extra"]:   print("  EXTRA  :", cmp_report["extra"])

            overlay = draw_overlay(frame, components, cables, measured_edges_spec, det2spec)
            ov_path = out_dir / f"overlay_{ts}.png"
            cv2.imwrite(str(ov_path), overlay)

            with spec_lock:
                raw_spec = spec_state["raw"]
            payload_full = {
                "timestamp": ts,
                "spec_raw": raw_spec,
                "detected_components": components,
                "detected_cables": cables,
                "mapping_det2spec": det2spec,
                "measured_edges_spec": sorted(list(measured_edges_spec)),
                "compare": cmp_report,
                "cable_attach_debug": cable_attach
            }
            js_path = out_dir / f"report_{ts}.json"
            with open(js_path, "w", encoding="utf-8") as f:
                json.dump(payload_full, f, ensure_ascii=False, indent=2)

            # ===== MQTT 결과 발행 (정책 적용) =====
            verdict = cmp_report["verdict"]
            should_publish = False
            if VERDICT_PUBLISH_MODE == "once":
                should_publish = not published_once
            elif VERDICT_PUBLISH_MODE == "on_change":
                should_publish = (verdict != last_sent_verdict)
            else:  # "always"
                should_publish = True

            if should_publish:
                verdict_msg = {
                    "event": "pcb_judgement",
                    "client_id": CLIENT_ID,
                    "timestamp": ts,
                    "job_id": cur_job_id,
                    "spec_hash": cur_spec_hash,
                    "verdict": verdict,
                    "ok": cmp_report["ok"],
                    "missing": cmp_report["missing"],
                    "extra": cmp_report["extra"]
                }
                try:
                    mqtt_publish_json(mqtt_client, PUB_TOPIC, verdict_msg, qos=MQTT_QOS, retain=False)
                    print(f"[MQTT] published verdict → {PUB_TOPIC} : {verdict}")
                    published_once = True
                    last_sent_verdict = verdict
                except Exception as e:
                    print(f"[MQTT][ERR] publish failed: {e}")
            else:
                reason = {"once": "이미 1회 발행됨",
                          "on_change": "판정 변화 없음",
                          "always": "정책상 항상 발행"}[VERDICT_PUBLISH_MODE if VERDICT_PUBLISH_MODE!="always" else "always"]
                print(f"[MQTT] skip publish ({reason})")

            cv2.putText(annotated, f"VERDICT: {verdict}", (10, 90),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,200,255), 2, cv2.LINE_AA)
            cv2.imshow(win, annotated)
            print(f"[SAVED] {ov_path}\n[SAVED] {js_path}\n[REPORT] {verdict}")

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()