#!/bin/sh
set -eu

SERVICE_NAME='tg-ai-bot'
FORMAT_VERSION='1'
START_DIR=$(pwd)
SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=''
ENV_TMP=''
ARCHIVE_TMP=''
RESTART_SERVICE='0'

usage() {
  cat <<'EOF'
用法：
  sh scripts/migrate.sh export [备份文件.tar.gz]
  sh scripts/migrate.sh import <备份文件.tar.gz> [--force]

export 会备份 .env 和 Docker 数据卷。
import 会恢复数据并重新构建、启动机器人。
EOF
}

die() {
  printf '迁移失败：%s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ "$RESTART_SERVICE" = '1' ]; then
    docker compose start "$SERVICE_NAME" >/dev/null 2>&1 || true
    RESTART_SERVICE='0'
  fi
  if [ -n "$ENV_TMP" ]; then
    rm -f "$ENV_TMP"
  fi
  if [ -n "$ARCHIVE_TMP" ]; then
    rm -f "$ARCHIVE_TMP"
  fi
  if [ -n "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT HUP INT TERM

absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$START_DIR" "$1" ;;
  esac
}

require_tools() {
  command -v docker >/dev/null 2>&1 || die '没有找到 docker 命令。'
  command -v tar >/dev/null 2>&1 || die '没有找到 tar 命令。'
  docker compose version >/dev/null 2>&1 || die '需要 Docker Compose v2（docker compose）。'
}

ensure_image() {
  if [ -z "$(docker compose images -q "$SERVICE_NAME" 2>/dev/null)" ]; then
    printf '未找到机器人镜像，正在构建...\n'
    docker compose build "$SERVICE_NAME"
  fi
}

validate_archive_entries() {
  entries=$(tar -tzf "$1") || die '无法读取备份压缩包。'
  old_ifs=$IFS
  IFS='
'
  for entry in $entries; do
    case "$entry" in
      /*|../*|*/../*|*/..)
        IFS=$old_ifs
        die '备份压缩包包含不安全路径。'
        ;;
    esac
    case "$entry" in
      manifest.txt|.env|data|data/|data/*) ;;
      *)
        IFS=$old_ifs
        die '备份压缩包包含未知文件。'
        ;;
    esac
  done
  IFS=$old_ifs
}

export_backup() {
  [ "$#" -le 1 ] || die 'export 参数过多。'
  [ -f .env ] || die '当前项目没有 .env，无法导出完整配置。'

  if [ "$#" -ge 1 ]; then
    archive=$(absolute_path "$1")
  else
    archive="$PROJECT_DIR/tg-aibot-backup-$(date -u +%Y%m%d-%H%M%S).tar.gz"
  fi

  [ ! -e "$archive" ] || die "备份文件已存在：$archive"
  [ -d "$(dirname "$archive")" ] || die '备份文件的上级目录不存在。'

  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tg-aibot-export.XXXXXX")
  mkdir -p "$TMP_DIR/data"
  cp .env "$TMP_DIR/.env"
  printf 'format_version=%s\ncreated_at=%s\n' \
    "$FORMAT_VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP_DIR/manifest.txt"

  ensure_image
  if [ -n "$(docker compose ps --status running -q "$SERVICE_NAME" 2>/dev/null)" ]; then
    printf '正在短暂停止机器人以生成一致备份...\n'
    docker compose stop "$SERVICE_NAME"
    RESTART_SERVICE='1'
  fi
  printf '正在读取 Docker 数据卷...\n'
  docker compose run --rm --no-deps -T --user 0:0 \
    -v "$TMP_DIR/data:/backup" \
    --entrypoint sh "$SERVICE_NAME" \
    -c 'cp -a /app/data/. /backup/'

  if [ "$RESTART_SERVICE" = '1' ]; then
    docker compose start "$SERVICE_NAME"
    RESTART_SERVICE='0'
  fi

  ARCHIVE_TMP="${archive}.tmp.$$"
  tar -czf "$ARCHIVE_TMP" -C "$TMP_DIR" manifest.txt .env data
  chmod 600 "$ARCHIVE_TMP"
  mv "$ARCHIVE_TMP" "$archive"
  ARCHIVE_TMP=''

  printf '迁移备份已生成：%s\n' "$archive"
  printf '注意：备份包含 BOT_TOKEN 和 AI_API_KEY，请勿上传或公开分享。\n'
}

import_backup() {
  [ "$#" -ge 1 ] || die 'import 缺少备份文件路径。'
  [ "$#" -le 2 ] || die 'import 参数过多。'
  archive=$(absolute_path "$1")
  force=${2:-}

  if [ -n "$force" ] && [ "$force" != '--force' ]; then
    die '未知参数；覆盖已有部署请使用 --force。'
  fi
  [ -f "$archive" ] || die "找不到备份文件：$archive"
  if [ -e .env ] && [ "$force" != '--force' ]; then
    die '当前目录已有 .env；确认要覆盖时请在命令末尾添加 --force。'
  fi

  validate_archive_entries "$archive"
  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tg-aibot-import.XXXXXX")
  tar --no-same-owner -xzf "$archive" -C "$TMP_DIR"

  [ -f "$TMP_DIR/manifest.txt" ] || die '备份缺少 manifest.txt。'
  grep -q "^format_version=$FORMAT_VERSION$" "$TMP_DIR/manifest.txt" || die '不支持的备份格式版本。'
  [ -f "$TMP_DIR/.env" ] || die '备份缺少 .env。'
  [ -d "$TMP_DIR/data" ] || die '备份缺少 data 目录。'

  ENV_TMP="$PROJECT_DIR/.env.migrate.$$"
  cp "$TMP_DIR/.env" "$ENV_TMP"
  chmod 600 "$ENV_TMP"
  mv -f "$ENV_TMP" "$PROJECT_DIR/.env"
  ENV_TMP=''

  ensure_image
  docker compose stop "$SERVICE_NAME" >/dev/null 2>&1 || true

  printf '正在恢复 Docker 数据卷...\n'
  docker compose run --rm --no-deps -T --user 0:0 \
    -v "$TMP_DIR/data:/restore:ro" \
    --entrypoint sh "$SERVICE_NAME" \
    -c 'rm -rf /app/data/* /app/data/.[!.]* /app/data/..?*; cp -a /restore/. /app/data/; chown -R app:app /app/data'

  docker compose up -d --build "$SERVICE_NAME"
  printf '迁移完成，机器人已经启动。\n'
  printf '可运行 docker compose logs -f 查看启动日志。\n'
}

cd "$PROJECT_DIR"

case "${1:-}" in
  export)
    shift
    require_tools
    export_backup "$@"
    ;;
  import)
    shift
    require_tools
    import_backup "$@"
    ;;
  -h|--help|help|'')
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
