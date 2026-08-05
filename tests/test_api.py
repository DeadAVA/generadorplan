import unittest
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


class ApiIntegrationTests(unittest.TestCase):
    def test_full_athlete_and_plan_workflow(self):
        with TestClient(app) as client:
            suffix = uuid4().hex[:8]
            original_name = f"ATLETA DE PRUEBA {suffix}"
            edited_name = f"ATLETA EDITADO {suffix}"

            forwarded_host = client.get(
                "/api/health",
                headers={"host": "cloudflare-origin.internal"},
            )
            self.assertEqual(forwarded_host.status_code, 200, forwarded_host.text)

            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertGreaterEqual(health.json()["athletes"], 5)

            payload = {
                "name": original_name,
                "category": "400-800",
                "birth_date": None,
                "gender": "",
                "contact": "",
                "notes": "Prueba integrada",
                "active": True,
                "pace_zones": [
                    {"zone": "Z5", "pace_min": "03:30", "pace_max": "03:45"},
                    {"zone": "Z4", "pace_min": "03:50", "pace_max": "04:05"},
                    {"zone": "Z3", "pace_min": "04:10", "pace_max": "04:30"},
                    {"zone": "Z2", "pace_min": "04:35", "pace_max": "05:00"},
                    {"zone": "Z1", "pace_min": "05:05", "pace_max": "05:30"},
                ],
            }
            created = client.post("/api/athletes", json=payload)
            self.assertEqual(created.status_code, 201, created.text)
            athlete_id = created.json()["id"]

            payload["name"] = edited_name
            edited = client.put(f"/api/athletes/{athlete_id}", json=payload)
            self.assertEqual(edited.status_code, 200, edited.text)
            self.assertEqual(edited.json()["name"], edited_name)

            generated = client.post("/api/plans/generate/automatic", json={
                "athlete_id": athlete_id,
                "start_date": "2026-01-06",
                "goal": "400-800",
                "level": "intermediate",
                "days_per_week": 6,
                "weekly_km": 45,
                "category": "LIBRE",
                "hours_per_week": 11,
            })
            self.assertEqual(generated.status_code, 201, generated.text)
            plan = generated.json()
            self.assertEqual(len(plan["days"]), 7)
            self.assertGreater(sum(len(day["exercises"]) for day in plan["days"]), 10)
            self.assertEqual(plan["athlete_name"], edited_name)

            read_plan = client.get(f"/api/plans/{plan['id']}")
            self.assertEqual(read_plan.status_code, 200)
            self.assertIn("drop isométrico", read_plan.text)
            self.assertEqual(client.get(f"/print?id={plan['id']}").status_code, 200)
            backup = client.get("/api/backups/json")
            self.assertEqual(backup.status_code, 200)

            deleted = client.delete(f"/api/athletes/{athlete_id}")
            self.assertEqual(deleted.status_code, 204)
            self.assertEqual(client.get(f"/api/plans/{plan['id']}").status_code, 404)

            restored = client.post(
                "/api/backups/json",
                files={"file": ("backup.json", backup.content, "application/json")},
            )
            self.assertEqual(restored.status_code, 200, restored.text)
            restored_athletes = client.get("/api/athletes?include_inactive=true").json()
            restored_test = next(item for item in restored_athletes if item["name"] == edited_name)
            restored_plans = client.get(f"/api/plans?athlete_id={restored_test['id']}").json()
            self.assertEqual(len(restored_plans), 1)


if __name__ == "__main__":
    unittest.main()
