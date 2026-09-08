// RBAC: 라우트는 "admin" 같은 역할 이름이 아니라 권한 이름(예: "ocr:scan")만 알면 된다.
// 어떤 역할이 어떤 권한을 갖는지는 DB(roles/permissions/role_permissions)가 갖고 있고,
// 여기서는 그 매핑을 조회해 세션의 role이 요청된 권한을 갖는지만 확인한다.
const pool = require("../db");

// role_permissions는 배포 중 거의 바뀌지 않는 참조 데이터이므로 요청마다 조회하지 않고 캐싱한다.
let permissionsByRole = null;

async function loadPermissions() {
  const [rows] = await pool.query(
    `SELECT roles.name AS role_name, permissions.name AS permission_name
     FROM role_permissions
     JOIN roles ON roles.id = role_permissions.role_id
     JOIN permissions ON permissions.id = role_permissions.permission_id`
  );

  const map = {};
  for (const row of rows) {
    if (!map[row.role_name]) map[row.role_name] = new Set();
    map[row.role_name].add(row.permission_name);
  }
  permissionsByRole = map;
}

// 미들웨어로 걸기 애매하게 같은 라우트가 권한에 따라 다른 걸 보여줘야 할 때(예: GET /api/reservations
// 에서 patient는 본인 것만, staff/admin은 전체)를 위해, 미들웨어와 별개로 직접 조회할 수 있게 분리.
async function hasPermission(role, permissionName) {
  if (!permissionsByRole) {
    await loadPermissions();
  }
  return Boolean(permissionsByRole[role]?.has(permissionName));
}

function requirePermission(permissionName) {
  return async function (req, res, next) {
    if (!req.session.patientId) {
      return res.status(401).json({ message: "로그인이 필요합니다." });
    }

    try {
      const allowed = await hasPermission(req.session.role, permissionName);
      if (!allowed) {
        return res.status(403).json({ message: "권한이 없습니다." });
      }
      next();
    } catch (err) {
      console.error("[requirePermission error]", err);
      res.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  };
}

module.exports = requirePermission;
module.exports.hasPermission = hasPermission;
