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
  for cmd in docker git; do
    if ! command -v "$cmd" &>/dev/null; then
      error "缺少依赖: $cmd，请先安装"
      exit 1
    fi
  done
  # 新版 docker 内置 compose，独立 docker-compose 不一定存在
  if ! docker compose version &>/dev/null; then
    error "docker compose 插件不可用"
    exit 1
  fi
  docker info &>/dev/null || { error "Docker 未运行"; exit 1; }
}

ensure_swap() {
  local swap_file="${SWAP_FILE:-/swapfile}"
  local swap_size_mb="${SWAP_SIZE_MB:-2048}"

  if swapon --show --noheadings | grep -q .; then
    info "已检测到启用的 swap，跳过创建"
    return 0
  fi

  if [ "$(id -u)" -ne 0 ]; then
    warn "未以 root 运行，跳过 swap 创建；2GB 内存服务器建议配置 ${swap_size_mb}MB swap"
    return 0
  fi

  info "未检测到 swap，创建 ${swap_size_mb}MB swap 以降低构建时内存耗尽的风险..."
  if ! fallocate -l "${swap_size_mb}M" "$swap_file" 2>/dev/null; then
    dd if=/dev/zero of="$swap_file" bs=1M count="$swap_size_mb" status=progress
  fi
  chmod 600 "$swap_file"
  mkswap "$swap_file" >/dev/null
  swapon "$swap_file"

  if ! grep -qE "^[^#]*[[:space:]]${swap_file}[[:space:]]" /etc/fstab; then
    printf '%s none swap sw 0 0\n' "$swap_file" >> /etc/fstab
  fi
  info "swap 已启用并写入 /etc/fstab"
}

setup_env() {
  if [ ! -f .env.production ]; then
    info "生成 .env.production ..."
    cat > .env.production <<'ENVEOF'
JWT_SECRET=change-me-to-a-random-string
VITE_COLLAB_WS_URL=wss://wiseflow.site/collab
ENVEOF
    info ".env.production 已生成，请修改 JWT_SECRET 后再部署"
    ${EDITOR:-vi} .env.production
  fi

  # source it so docker compose picks up the variables
  set -a; source .env.production; set +a
}

update_code() {
  if git rev-parse --git-dir &>/dev/null; then
    info "拉取最新代码..."
    git pull
  fi
}

wait_for_postgres() {
  info "等待 PostgreSQL 就绪..."
  for i in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U collab -d collab_doc &>/dev/null; then
      info "PostgreSQL 已就绪"
      return 0
    fi
    sleep 2
  done

  error "PostgreSQL 未就绪，请检查 postgres 容器日志"
  docker compose logs --tail=80 postgres || true
  exit 1
}

run_migrations() {
  info "执行数据库迁移..."
  # 确保 postgres 完全就绪后，在 server 容器内执行 migrate
  # DATABASE_URL 在 docker compose.yml 的 server 服务中已定义，无需从宿主机传入
  docker compose run --rm --no-deps \
    server npx prisma migrate deploy
}

seed_demo() {
  info "初始化演示账号..."
  # 首次执行可能报错（种子已存在），忽略
  docker compose run --rm --no-deps \
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
    docker compose up -d postgres
    # 串行构建，避免 1.6GB 内存并行 OOM
    # web 构建最重（tsc + vite），单独先做
    info "编译 web ..."
    DOCKER_BUILDKIT=1 docker compose build web
    info "编译 server ..."
    DOCKER_BUILDKIT=1 docker compose build server
    info "重启服务 ..."
    docker compose up -d --no-deps server web
  else
    info "全量部署：构建并启动所有服务..."
    docker compose down --remove-orphans 2>/dev/null || true
    COMPOSE_BAKE=true docker compose build
    docker compose up -d
  fi

  wait_for_postgres
  run_migrations
  seed_demo

  local web_port
  web_port=$(docker compose port web 80 2>/dev/null | sed 's/.*://' || echo "80")
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
ensure_swap

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
