# =============================================================================
# 叽里呱啦 · Nginx 反向代理镜像
# -----------------------------------------------------------------------------
# 用途：当用 Docker Compose 同时跑 nginx + api 时，用本镜像构建反代层。
#       宿主机直接装 nginx 则不需要本文件（直接用 deploy/nginx/nginx.conf）。
#
# 构建：
#   docker build -t balabala-nginx -f deploy/nginx/Dockerfile .
#
# 运行时需要：
#   - 把前端产物挂载到 /var/www/balabala/web/dist
#   - 把 Let's Encrypt 证书挂载到 /etc/letsencrypt:ro
#   - 把 webroot 挂载到 /var/www/letsencrypt（certbot 续期用）
#   - upstream 指向 api:8787（见 nginx.conf 注释）
# =============================================================================
FROM nginx:1.27-alpine

# 时间戳 + 常用镜像源（国内构建可取消注释使用）
# RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 用项目配置替换默认站点；保留 mime.types / 全局 nginx.conf 框架
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf

# 新建约定目录（由 compose 挂载卷覆盖真实内容）
RUN mkdir -p /var/www/balabala/web/dist /var/www/letsencrypt /var/log/nginx

EXPOSE 80 443

# 容器内做一次配置自检，失败即快速崩溃（fail fast）
RUN nginx -t

CMD ["nginx", "-g", "daemon off;"]
