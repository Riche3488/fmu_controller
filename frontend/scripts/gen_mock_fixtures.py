"""modelDescription.xml -> mock fixture JSON (fmus.json, variables.json).

Usage: python gen_mock_fixtures.py <modelDescription.xml> <outdir>
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

N_PARAMS = 300
TYPES = ("Real", "Integer", "Boolean", "String", "Enumeration")


def parse_start(type_name, raw):
    if raw is None:
        return None
    if type_name == "Real":
        return float(raw)
    if type_name in ("Integer", "Enumeration"):
        return int(raw)
    if type_name == "Boolean":
        return raw == "true"
    return raw


def main(md_path, outdir):
    root = ET.parse(md_path).getroot()
    variables = []
    for sv in root.iter("ScalarVariable"):
        type_el = next(el for el in sv if el.tag in TYPES)
        variables.append({
            "name": sv.get("name"),
            "valueReference": int(sv.get("valueReference")),
            "causality": sv.get("causality", "local"),
            "variability": sv.get("variability", "continuous"),
            "type": type_el.tag,
            "start": parse_start(type_el.tag, type_el.get("start")),
            "unit": type_el.get("unit"),
            "description": sv.get("description"),
        })
    params = [v for v in variables if v["causality"] == "parameter"]
    outputs = [v for v in variables if v["causality"] == "output"]
    exp = root.find("DefaultExperiment")
    fmi_types = [t for t in ("ModelExchange", "CoSimulation") if root.find(t) is not None]
    fmu = {
        "id": "a1b2c3d4e5f60718",
        "fileName": "my_0test_DriveCycleAT.fmu",
        "modelName": root.get("modelName"),
        "guid": root.get("guid"),
        "fmiVersion": root.get("fmiVersion"),
        "fmiTypes": fmi_types,
        "generationTool": root.get("generationTool"),
        "defaultExperiment": {
            "startTime": float(exp.get("startTime", 0)),
            "stopTime": float(exp.get("stopTime", 1)),
            "tolerance": float(exp.get("tolerance")) if exp.get("tolerance") else None,
        },
        "nParameters": len(params),
        "nOutputs": len(outputs),
        "nVariables": len(variables),
        "uploadedAt": "2026-10-29T01:09:08Z",
        "nRuns": 0,
    }
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "fmus.json").write_text(json.dumps([fmu], indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "variables.json").write_text(
        json.dumps(params[:N_PARAMS] + outputs, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
