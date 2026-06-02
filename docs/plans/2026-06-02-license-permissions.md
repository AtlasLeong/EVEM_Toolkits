# License Permissions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add package-based script permissions for activation codes without breaking already distributed clients.

**Architecture:** Keep the existing activation endpoint compatible, add a new `License` Django app backed by an independent `evem_license` database, and compute permissions as plan scripts plus per-code extra scripts. New clients consume `permissions.scripts`; old clients keep ignoring the extra response fields and continue working.

**Tech Stack:** Django 4.2, Django REST Framework, MySQL, Python unittest, AT_Simulation CustomTkinter client.

---

### Task 1: Backend License App

**Files:**
- Create: `backend/License/`
- Modify: `backend/EVE_MDjango/settings.py`
- Modify: `backend/EVE_MDjango/urls.py`

**Steps:**
1. Add a `License` app with models for script products, plans, activation codes, extra scripts, and validation logs.
2. Configure a `license` database alias from `LICENSE_DB_*` environment variables, falling back to the default DB settings for local tests.
3. Add a database router so only the `License` app uses the `license` database.
4. Register `/api/license/` routes for new license generation and validation.

### Task 2: Permission Calculation

**Files:**
- Create: `backend/License/services.py`
- Modify: `backend/ActivationCode/views.py`

**Steps:**
1. Implement validation against the new license database first.
2. If no new license code exists, validate against the legacy `activation_code` table.
3. Legacy codes return default-plan permissions to avoid affecting already distributed default-group clients.
4. New codes return plan permissions plus code-specific extra scripts; VIP plans return every active script.
5. Keep old response fields unchanged and only add `permissions`.

### Task 3: Backend Tests

**Files:**
- Create: `backend/License/tests.py`
- Modify: `backend/ActivationCode/tests.py`

**Steps:**
1. Test default plan returns its four scripts.
2. Test extra scripts are added for a specific activation code.
3. Test VIP grants all active scripts.
4. Test legacy activation codes still validate and receive default permissions.

### Task 4: Client Permission Parsing

**Files:**
- Modify: `D:/Code/AT_Simulation/core/activation.py`
- Modify: `D:/Code/AT_Simulation/core/script_runner.py`
- Modify: `D:/Code/AT_Simulation/gui/main_window.py`

**Steps:**
1. Parse `permissions.scripts` from activation validation.
2. Map stable script IDs to existing Chinese script names.
3. Filter the visible script list by backend permissions and packaging visibility.
4. Enforce permissions again inside `ScriptRunner.run_script()`.
5. Treat missing `permissions` as all scripts allowed for backward-compatible servers.

### Task 5: Operator Setup

**Files:**
- Create: `backend/License/management/commands/seed_license_defaults.py`

**Steps:**
1. Seed the default script catalog.
2. Create `default` and `vip` plans.
3. Bind the four default scripts to the default plan.
4. Provide copy-paste SQL/commands for creating the `evem_license` database and running migrations.

