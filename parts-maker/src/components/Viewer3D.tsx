import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { DepthResult } from "../lib/depth";

type Props = {
  depth: DepthResult | null;
  busy?: boolean;
  onBuild: () => void;
};

/**
 * Orbitable displacement mesh from monocular depth + color texture.
 * Labels engine so users know real DA-V2 vs heuristic stub.
 */
export function Viewer3D({ depth, busy, onBuild }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [wire, setWire] = useState(false);
  const [strength, setStrength] = useState(0.55);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const depthRef = useRef(depth);
  const strengthRef = useRef(strength);
  depthRef.current = depth;
  strengthRef.current = strength;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1824);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(0, 0.15, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    const dir = new THREE.DirectionalLight(0xffe0b0, 0.9);
    dir.position.set(2, 3, 4);
    scene.add(amb, dir);

    const grid = new THREE.GridHelper(4, 16, 0x3a4a5c, 0x243040);
    grid.position.y = -1.05;
    scene.add(grid);

    let frame = 0;
    const resize = () => {
      const w = host.clientWidth || 320;
      const h = host.clientHeight || 280;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const rebuild = async (d: DepthResult, disp: number, useWire: boolean) => {
      if (meshRef.current) {
        scene.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        const m = meshRef.current.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
        meshRef.current = null;
      }

      const aspect = d.width / d.height;
      const planeH = 2;
      const planeW = planeH * aspect;
      const segX = Math.min(180, Math.max(40, Math.round(d.width / 3)));
      const segY = Math.min(280, Math.max(60, Math.round(d.height / 3)));
      const geo = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
      const pos = geo.attributes.position!;
      const uv = geo.attributes.uv!;

      for (let i = 0; i < pos.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        const x = Math.min(d.width - 1, Math.max(0, Math.round(u * (d.width - 1))));
        // three UV v is bottom-up; our depth is top-down
        const y = Math.min(
          d.height - 1,
          Math.max(0, Math.round((1 - v) * (d.height - 1))),
        );
        const z = d.depth[y * d.width + x]! * disp;
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();

      const loader = new THREE.TextureLoader();
      const map = await loader.loadAsync(d.colorUrl);
      map.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.75,
        metalness: 0.05,
        wireframe: useWire,
        alphaTest: 0.08,
      });
      matRef.current = mat;
      const mesh = new THREE.Mesh(geo, mat);
      meshRef.current = mesh;
      scene.add(mesh);
    };

    // expose rebuild via host dataset trigger handled below
    (host as HTMLDivElement & { __rebuild?: typeof rebuild }).__rebuild = rebuild;

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (meshRef.current) {
        meshRef.current.geometry.dispose();
        const m = meshRef.current.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
      host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current as
      | (HTMLDivElement & {
          __rebuild?: (d: DepthResult, disp: number, w: boolean) => Promise<void>;
        })
      | null;
    if (!host?.__rebuild || !depth) return;
    void host.__rebuild(depth, strength, wire);
  }, [depth, strength, wire]);

  const isReal = !!depth?.engine.startsWith("depth-anything");

  return (
    <div className="viewer3d">
      <div className="viewer3d-head">
        <h2>3D 미리보기</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={onBuild}
        >
          {busy ? "깊이 추정 중…" : "깊이→메시 생성"}
        </button>
      </div>
      <div ref={hostRef} className="viewer3d-canvas" />
      <div className="viewer3d-controls">
        <label className="slider-label">
          입체감
          <input
            type="range"
            min={10}
            max={120}
            value={Math.round(strength * 100)}
            onChange={(e) => setStrength(Number(e.target.value) / 100)}
            disabled={!depth}
          />
        </label>
        <label className="slider-label">
          <input
            type="checkbox"
            checked={wire}
            onChange={(e) => setWire(e.target.checked)}
            disabled={!depth}
          />
          와이어
        </label>
      </div>
      {depth && (
        <div className="viewer3d-maps">
          <figure>
            <img src={depth.depthUrl} alt="depth map" />
            <figcaption>Depth</figcaption>
          </figure>
          <figure>
            <img src={depth.normalUrl} alt="normals" />
            <figcaption>Normals</figcaption>
          </figure>
        </div>
      )}
      <p className={`status viewer3d-engine${isReal ? " real" : ""}`}>
        {depth
          ? `${isReal ? "실제 깊이" : "스텁 깊이"} · ${depth.engine}`
          : "현재 뷰 이미지로 깊이를 추정해 오빗 메시를 만듭니다."}
      </p>
    </div>
  );
}
