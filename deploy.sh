#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# collab-doc-platform 一键部署脚本
# 用法:
#   chmod +x deploy.sh
#   ./deploy.sh                             # 首次部署
#   ./deploy.sh --update                    # 只更新代码和镜像，不重建数据库
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { printf "${GREEN}[INFO]${NC}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$*"; }

check_prereqs() {
  for cmd in docker docker-compose git; do
    if ! command -v "$cmd" &>/dev/null; then
      error "缺少依赖: $cmd，请先安装"
      exit 1
    fi
  done
  docker info &>/dev/null || { error "Docker 未运行"; exit 1; }
}

setup_env() {
  if [ ! -f .env.production ]; then
    info "生成 .env.production ..."
    cat > .env.production <<'ENVEOF'
JWT_SECRET=change-me-to-a-random-string
ENVEOF
    info ".env.production 已生成，请修改 JWT_SECRET 后再部署"
    ${EDITOR:-vi} .env.production
  fi

  # source it so docker-compose picks up the variables
  set -a; source .env.production; set +a
}

update_code() {
  if git rev-parse --git-dir &>/dev/null; then
    info "拉取最新代码..."
    git pull
  fi
}

run_migrations() {
  info "执行数据库迁移..."
  # 确保 postgres 完全就绪后，在 server 容器内执行 migrate
  docker-compose run --rm --no-deps \
    -e DATABASE_URL="${DATABASE_URL}" \
    server npx prisma migrate deploy
}

seed_demo() {
  info "初始化演示账号..."
  # 首次执行可能报错（种子已存在），忽略
  docker-compose run --rm --no-deps \
    -e DATABASE_URL="${DATABASE_URL}" \
    -e SEED_USER_EMAIL="${SEED_USER_EMAIL:-demo@collab.dev}" \
    -e SEED_USER_PASSWORD="${SEED_USER_PASSWORD:-demo1234}" \
    -e SEED_USER_NAME="${SEED_USER_NAME:-Dong Yaning}" \
    -e SEED_SECOND_USER_EMAIL="${SEED_SECOND_USER_EMAIL:-reviewer@collab.dev}" \
    -e SEED_SECOND_USER_PASSWORD="${SEED_SECOND_USER_PASSWORD:-reviewer1234}" \
    -e SEED_SECOND_USER_NAME="${SEED_SECOND_USER_NAME:-Reviewer}" \
    server npx tsx prisma/seed.ts 2>/dev/null || warn "种子数据可能已存在（首次部署可忽略）"
}

deploy() {
  local update_only="${1:-false}"

  if [ "$update_only" = true ]; then
    info "增量更新：重建 server 和 web ..."
    docker-compose build server web
    docker-compose up -d --no-deps server web
  else
    info "全量部署：构建并启动所有服务..."
    docker-compose down --remove-orphans 2>/dev/null || true
    docker-compose build
    docker-compose up -d
  fi

  # 等待 postgres 就绪
  info "等待 PostgreSQL 就绪..."
  for i in $(seq 1 30); do
    if docker-compose exec -T postgres pg_isready -U collab -d collab_doc &>/dev/null; then
      info "PostgreSQL 已就绪"
      break
    fi
    sleep 2
  done

  run_migrations
  seed_demo

  local web_port
  web_port=$(docker-compose port web 80 2>/dev/null | sed 's/.*://' || echo "80")
  info ""
  printf "${GREEN}========================================${NC}\n"
  printf "${GREEN}  部署完成！${NC}\n"
  printf "${GREEN}========================================${NC}\n"
  printf "\n"
  printf "  访问地址: http://服务器IP:${web_port}\n"
  printf "  演示账号: demo@collab.dev / demo1234\n"
  printf "\n"
}

cleanup() {
  info "清理旧镜像..."
  docker image prune -f
}

# ---- Main ----
check_prereqs

case "${1:-}" in
  --update)
    update_code
    set -a; [ -f .env.production ] && source .env.production; set +a
    deploy true
    cleanup
    ;;
  --help|-h)
    echo "用法: ./deploy.sh [--update | --help]"
    echo ""
    echo "  (无参数)    首次全量部署"
    echo "  --update    仅更新代码和镜像（保留数据）"
    echo "  --help      显示此帮助"
    exit 0
    ;;
  *)
    setup_env
    deploy false
    cleanup
    ;;
esac
