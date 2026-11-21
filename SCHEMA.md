# MaiLuo · 分析结果 JSON 数据模型

## 概览

Claude Code 的输出契约：将一个 Vue 组件的所有业务功能拆解为独立的链路，每条链路从前端事件处理器开始，经过 API 封装、HTTP 请求、后端 Controller/Service/Repository，最后到达 SQL 或外部服务。

**核心设计思路：**
- 每个功能 ≠ 单个 API，而是一条从前端事件到后端数据库的完整链路
- 支持条件分支（如参数校验失败、业务逻辑判断）和异常处理
- 节点带有类型标记和源码位置，便于跳转和二次定位
- 兼容 ECharts 可视化和 CSS 纯文本降级

---

## 顶层结构

```json
{
  "component": {
    "file": "frontend/src/views/OrderList.vue",
    "name": "OrderList",
    "description": "订单管理页面",
    "language": "vue3"
  },
  "chains": [
    // 链路数组，每个对象代表一个业务功能
  ],
  "metadata": {
    "analyzedAt": "2026-11-21T10:30:00Z",
    "projectRoot": "D:\\Projects\\my-app",
    "statistics": {
      "totalChains": 3,
      "totalNodes": 27,
      "totalClasses": 11,
      "totalMethods": 19,
      "branches": 2,
      "transactions": 1
    }
  }
}
```

---

## 链路对象（Chain）

```json
{
  "id": "create_order",
  "name": "创建订单",
  "description": "用户填写订单信息并提交，系统创建订单并扣减库存",
  "businessFunction": "新增",
  "method": "POST",
  "apiPath": "/api/order/create",
  "status": "success",
  "tags": ["transaction", "复杂逻辑"],
  
  "frontendAnchor": {
    // 前端源码位置
  },
  
  "nodes": [
    // 链路中的所有节点
  ],
  
  "edges": [
    // 节点之间的连接关系
  ],
  
  "branches": [
    // 条件分支和异常处理
  ],
  
  "statistics": {
    "nodeCount": 9,
    "classCount": 4,
    "methodCount": 7,
    "hasBranch": true,
    "hasTransaction": true,
    "hasException": false,
    "depth": 5
  }
}
```

---

## 前端锚点（FrontendAnchor）

前端源码的具体定位：

```json
{
  "frontendAnchor": {
    "template": {
      "file": "frontend/src/views/OrderList.vue",
      "line": 42,
      "code": "<button @click=\"handleCreateOrder\">提交订单</button>",
      "selector": "handleCreateOrder"
    },
    "script": {
      "file": "frontend/src/views/OrderList.vue",
      "line": 145,
      "method": "handleCreateOrder",
      "signature": "async handleCreateOrder(orderData) { ... }",
      "body": {
        "start": 146,
        "end": 158
      }
    },
    "apiWrapper": {
      "file": "frontend/src/api/order.js",
      "line": 28,
      "function": "createOrder",
      "signature": "export function createOrder(payload) { ... }",
      "body": {
        "start": 28,
        "end": 32
      },
      "endpoint": "POST /api/order/create"
    }
  }
}
```

**字段说明：**
- `template.selector`: Vue 事件绑定的函数名，便于在 template 中快速定位
- `script.method`: 脚本中的处理函数名
- `script.body.start/end`: 函数体所在行号范围
- `apiWrapper.file`: API 封装层（通常在 `api/` 目录）
- `apiWrapper.endpoint`: 实际的 HTTP 路由

---

## 链路节点（Node）

```json
{
  "id": "node_01",
  "name": "OrderList.handleCreateOrder",
  "type": "vue-event",
  "layer": "frontend",
  "position": {
    "x": 100,
    "y": 200
  },
  "sourceFile": "frontend/src/views/OrderList.vue",
  "sourceLine": 145,
  "description": "用户点击「提交订单」按钮触发的事件处理器",
  
  "metadata": {
    "signature": "handleCreateOrder(orderData: OrderDTO): Promise<void>",
    "codeSnippet": "async handleCreateOrder(orderData) {\n  const res = await api.createOrder(orderData);\n  this.orders.push(res.data);\n  this.$message.success('订单创建成功');\n}",
    "imports": ["api"],
    "calls": ["api.createOrder"]
  }
}
```

**节点类型（NodeType）**

| 类型 | 所属层 | 示例 | 说明 |
|------|--------|------|------|
| `vue-event` | frontend | `handleCreateOrder` | Vue 组件事件处理器（@click 等） |
| `api-wrapper` | frontend | `createOrder` (api/order.js) | 前端 API 封装层 |
| `http-request` | frontend↔backend | POST /api/order/create | HTTP 请求（方法+路径） |
| `controller` | backend | `OrderController.createOrder()` | Spring Controller 方法 |
| `service` | backend | `OrderService.saveOrder()` | Service 层业务逻辑 |
| `validator` | backend | `OrderValidator.validate()` | 参数校验类 |
| `repository` | backend | `OrderRepository.save()` | Repository/Mapper 数据访问 |
| `sql` | backend | `INSERT INTO orders` | 数据库操作（SQL） |
| `exception` | backend | `MethodArgumentNotValidException` | 异常节点 |
| `external-service` | backend | `PaymentService.pay()` | 外部服务调用 |

**节点属性详解：**

```json
{
  "id": "node_03",
  "name": "OrderController.createOrder",
  "type": "controller",
  "layer": "backend",
  "position": { "x": 330, "y": 300 },
  
  "sourceFile": "backend/src/main/java/com/example/controller/OrderController.java",
  "sourceLine": 45,
  
  "description": "处理新建订单请求，委托给 Service 层",
  
  "metadata": {
    "class": "OrderController",
    "package": "com.example.controller",
    "signature": "@PostMapping(\"/api/order/create\")\npublic ResponseEntity<OrderVO> createOrder(@RequestBody CreateOrderRequest req)",
    "annotations": ["@PostMapping", "@Validated"],
    "codeSnippet": "@PostMapping(\"/api/order/create\")\npublic ResponseEntity<OrderVO> createOrder(@RequestBody CreateOrderRequest req) {\n  OrderVO vo = orderService.saveOrder(req);\n  return ResponseEntity.ok(vo);\n}",
    "callsService": "orderService.saveOrder(req)",
    "returnType": "OrderVO"
  },
  
  "tags": ["endpoint"],
  "status": "success"
}
```

---

## 链路连接（Edge）

```json
{
  "id": "edge_01_02",
  "source": "node_01",      // handleCreateOrder
  "target": "node_02",      // api.createOrder
  "type": "function-call",  // function-call | http-request | service-call | db-query
  "label": "api.createOrder(orderData)",
  "description": "前端事件处理器调用 API 封装函数",
  "metadata": {
    "callSite": "frontend/src/views/OrderList.vue:149",
    "arguments": ["orderData"],
    "returnType": "Promise<Order>"
  }
}
```

**连接类型：**
- `function-call`: 一般函数调用
- `http-request`: HTTP 请求边界（前端 → 后端）
- `service-call`: Service 层内部调用
- `db-query`: 数据库查询（Repository → SQL）
- `method-call`: 一般方法调用

---

## 条件分支（Branch）

某些链路在中途会有判断逻辑（如参数校验、业务逻辑判断）：

```json
{
  "id": "branch_01",
  "nodeId": "node_06",      // OrderValidator.validate() 所在的节点
  "condition": "验证 OrderDTO 的必填字段和业务规则",
  "type": "validation",     // validation | business-logic | permission-check
  
  "paths": [
    {
      "name": "success",
      "description": "验证通过",
      "condition": "req.items.length > 0 && req.totalPrice > 0",
      "nextNode": "node_07",  // 继续到 OrderService.saveOrder()
      "status": "success",
      "color": "#5F7D58"
    },
    {
      "name": "failure",
      "description": "验证失败",
      "condition": "req.items.length == 0",
      "exception": {
        "type": "MethodArgumentNotValidException",
        "message": "请至少选择一个商品",
        "httpStatus": 400
      },
      "nextNode": "node_exception_01",
      "status": "error",
      "color": "#B54A35"
    }
  ]
}
```

---

## 事务边界（Transaction）

标记 @Transactional 边界：

```json
{
  "id": "txn_01",
  "name": "@Transactional",
  "startNode": "node_07",    // OrderService.saveOrder()
  "endNode": "node_09",      // 最后一个数据库操作
  "operations": [
    {
      "type": "INSERT",
      "table": "orders",
      "sql": "INSERT INTO orders (id, user_id, total_price, status, created_at) VALUES (?, ?, ?, ?, ?)"
    },
    {
      "type": "UPDATE",
      "table": "stock",
      "sql": "UPDATE stock SET available_qty = available_qty - ? WHERE sku_id = ? AND available_qty >= ?"
    }
  ],
  "isolationLevel": "READ_COMMITTED",
  "propagation": "REQUIRED",
  "description": "在同一个事务内完成订单创建和库存扣减，保证原子性"
}
```

---

## 完整示例：OrderList.vue 三个功能

下面是一个完整的 OrderList 分析结果 JSON 示例。

```json
{
  "component": {
    "file": "frontend/src/views/OrderList.vue",
    "name": "OrderList",
    "description": "订单管理页面",
    "language": "vue3"
  },
  "chains": [
    {
      "id": "profile_get",
      "name": "加载用户信息",
      "businessFunction": "查询",
      "description": "页面加载时获取当前登录用户的个人信息",
      "method": "GET",
      "apiPath": "/api/user/profile",
      "status": "success",
      "tags": [],
      
      "frontendAnchor": {
        "template": {
          "file": "frontend/src/views/OrderList.vue",
          "line": 12,
          "code": "<div v-if=\"currentUser\">欢迎, {{ currentUser.name }}</div>",
          "selector": "currentUser"
        },
        "script": {
          "file": "frontend/src/views/OrderList.vue",
          "line": 78,
          "method": "onMounted",
          "signature": "onMounted(async () => { await loadUserProfile(); })",
          "body": { "start": 79, "end": 82 }
        },
        "apiWrapper": {
          "file": "frontend/src/api/user.js",
          "line": 12,
          "function": "getUserProfile",
          "signature": "export function getUserProfile() { return request.get('/api/user/profile'); }",
          "body": { "start": 12, "end": 14 },
          "endpoint": "GET /api/user/profile"
        }
      },
      
      "nodes": [
        {
          "id": "profile_n1",
          "name": "OrderList.onMounted",
          "type": "vue-event",
          "layer": "frontend",
          "position": { "x": 90, "y": 200 },
          "sourceFile": "frontend/src/views/OrderList.vue",
          "sourceLine": 78,
          "description": "Vue 生命周期钩子，页面挂载时执行",
          "metadata": {
            "signature": "onMounted(async () => { ... })",
            "codeSnippet": "onMounted(async () => {\n  this.currentUser = await api.getUserProfile();\n  this.loading = false;\n})",
            "calls": ["api.getUserProfile"]
          }
        },
        {
          "id": "profile_n2",
          "name": "getUserProfile",
          "type": "api-wrapper",
          "layer": "frontend",
          "position": { "x": 230, "y": 200 },
          "sourceFile": "frontend/src/api/user.js",
          "sourceLine": 12,
          "description": "API 封装函数，发送 GET 请求获取用户信息",
          "metadata": {
            "signature": "function getUserProfile()",
            "codeSnippet": "export function getUserProfile() {\n  return request.get('/api/user/profile');\n}",
            "endpoint": "GET /api/user/profile",
            "returnType": "Promise<UserProfile>"
          }
        },
        {
          "id": "profile_n3",
          "name": "GET /api/user/profile",
          "type": "http-request",
          "layer": "frontend-backend-boundary",
          "position": { "x": 370, "y": 200 },
          "description": "HTTP GET 请求，向后端发送 REST 调用",
          "metadata": {
            "method": "GET",
            "path": "/api/user/profile",
            "headers": ["Authorization: Bearer {token}"],
            "responseType": "UserProfileVO"
          }
        },
        {
          "id": "profile_n4",
          "name": "UserController.getUserProfile",
          "type": "controller",
          "layer": "backend",
          "position": { "x": 510, "y": 200 },
          "sourceFile": "backend/src/main/java/com/example/controller/UserController.java",
          "sourceLine": 25,
          "description": "Spring Controller 入口，接收 GET 请求",
          "metadata": {
            "class": "UserController",
            "package": "com.example.controller",
            "signature": "@GetMapping(\"/api/user/profile\")\npublic ResponseEntity<UserProfileVO> getUserProfile()",
            "annotations": ["@GetMapping"],
            "codeSnippet": "@GetMapping(\"/api/user/profile\")\npublic ResponseEntity<UserProfileVO> getUserProfile() {\n  UserProfileVO vo = userService.fetchCurrentUser();\n  return ResponseEntity.ok(vo);\n}",
            "callsService": "userService.fetchCurrentUser()",
            "returnType": "UserProfileVO"
          }
        },
        {
          "id": "profile_n5",
          "name": "UserService.fetchCurrentUser",
          "type": "service",
          "layer": "backend",
          "position": { "x": 650, "y": 200 },
          "sourceFile": "backend/src/main/java/com/example/service/UserService.java",
          "sourceLine": 42,
          "description": "业务逻辑层，从数据库获取用户信息",
          "metadata": {
            "class": "UserService",
            "signature": "public UserProfileVO fetchCurrentUser()",
            "codeSnippet": "public UserProfileVO fetchCurrentUser() {\n  Long userId = SecurityContextHolder.getUserId();\n  User user = userRepository.findById(userId).orElseThrow();\n  return user.toVO();\n}",
            "callsRepository": "userRepository.findById(userId)",
            "returnType": "UserProfileVO"
          }
        },
        {
          "id": "profile_n6",
          "name": "UserRepository.findById",
          "type": "repository",
          "layer": "backend",
          "position": { "x": 790, "y": 200 },
          "sourceFile": "backend/src/main/java/com/example/repository/UserRepository.java",
          "sourceLine": 18,
          "description": "数据访问层，执行数据库查询",
          "metadata": {
            "interface": "UserRepository extends JpaRepository<User, Long>",
            "signature": "Optional<User> findById(Long id);",
            "codeSnippet": "@Repository\npublic interface UserRepository extends JpaRepository<User, Long> {\n  Optional<User> findById(Long id);\n}",
            "executesSQL": "SELECT * FROM users WHERE id = ?"
          }
        },
        {
          "id": "profile_n7",
          "name": "SELECT * FROM users",
          "type": "sql",
          "layer": "backend",
          "position": { "x": 1000, "y": 200 },
          "description": "数据库 SQL 查询",
          "metadata": {
            "database": "MySQL",
            "table": "users",
            "sql": "SELECT * FROM users WHERE id = ?",
            "queryType": "SELECT",
            "indexHint": "PRIMARY KEY (id)"
          }
        }
      ],
      
      "edges": [
        {
          "id": "profile_e1",
          "source": "profile_n1",
          "target": "profile_n2",
          "type": "function-call",
          "label": "await api.getUserProfile()",
          "metadata": { "callSite": "frontend/src/views/OrderList.vue:80" }
        },
        {
          "id": "profile_e2",
          "source": "profile_n2",
          "target": "profile_n3",
          "type": "http-request",
          "label": "request.get(...)",
          "metadata": { "method": "GET", "endpoint": "/api/user/profile" }
        },
        {
          "id": "profile_e3",
          "source": "profile_n3",
          "target": "profile_n4",
          "type": "http-request",
          "label": "HTTP 请求",
          "metadata": { "protocol": "HTTP/1.1", "status": 200 }
        },
        {
          "id": "profile_e4",
          "source": "profile_n4",
          "target": "profile_n5",
          "type": "service-call",
          "label": "userService.fetchCurrentUser()",
          "metadata": { "callSite": "backend/src/.../UserController.java:27" }
        },
        {
          "id": "profile_e5",
          "source": "profile_n5",
          "target": "profile_n6",
          "type": "method-call",
          "label": "userRepository.findById(userId)",
          "metadata": { "callSite": "backend/src/.../UserService.java:44" }
        },
        {
          "id": "profile_e6",
          "source": "profile_n6",
          "target": "profile_n7",
          "type": "db-query",
          "label": "Hibernate ORM 映射",
          "metadata": { "orm": "JPA/Hibernate", "sqlGenerated": true }
        }
      ],
      
      "branches": [],
      
      "statistics": {
        "nodeCount": 7,
        "classCount": 3,
        "methodCount": 5,
        "hasBranch": false,
        "hasTransaction": false,
        "hasException": false,
        "depth": 6
      }
    },
    
    {
      "id": "order_update",
      "name": "修改订单",
      "businessFunction": "修改",
      "description": "用户修改订单信息，包含参数校验分支",
      "method": "POST",
      "apiPath": "/api/order/update",
      "status": "warning",
      "tags": ["条件分支"],
      
      "frontendAnchor": {
        "template": {
          "file": "frontend/src/views/OrderList.vue",
          "line": 68,
          "code": "<button @click=\"handleEditOrder(order)\">编辑</button>",
          "selector": "handleEditOrder"
        },
        "script": {
          "file": "frontend/src/views/OrderList.vue",
          "line": 142,
          "method": "handleEditOrder",
          "signature": "async handleEditOrder(order) { ... }",
          "body": { "start": 142, "end": 156 }
        },
        "apiWrapper": {
          "file": "frontend/src/api/order.js",
          "line": 20,
          "function": "updateOrder",
          "signature": "export function updateOrder(id, payload) { ... }",
          "body": { "start": 20, "end": 24 },
          "endpoint": "POST /api/order/update"
        }
      },
      
      "nodes": [
        {
          "id": "update_n1",
          "name": "OrderList.handleEditOrder",
          "type": "vue-event",
          "layer": "frontend",
          "position": { "x": 100, "y": 300 },
          "sourceFile": "frontend/src/views/OrderList.vue",
          "sourceLine": 142,
          "description": "用户点击「编辑」按钮触发的事件处理器",
          "metadata": {
            "signature": "async handleEditOrder(order)",
            "codeSnippet": "async handleEditOrder(order) {\n  const updated = { ...order, status: 'pending_review' };\n  try {\n    await api.updateOrder(order.id, updated);\n    this.$message.success('订单已更新');\n    this.loadOrders();\n  } catch (err) {\n    this.$message.error(err.message);\n  }\n}"
          }
        },
        {
          "id": "update_n2",
          "name": "updateOrder",
          "type": "api-wrapper",
          "layer": "frontend",
          "position": { "x": 230, "y": 300 },
          "sourceFile": "frontend/src/api/order.js",
          "sourceLine": 20,
          "metadata": {
            "signature": "function updateOrder(id, payload)",
            "codeSnippet": "export function updateOrder(id, payload) {\n  return request.post(`/api/order/update/${id}`, payload);\n}",
            "endpoint": "POST /api/order/update/{id}"
          }
        },
        {
          "id": "update_n3",
          "name": "POST /api/order/update",
          "type": "http-request",
          "layer": "frontend-backend-boundary",
          "position": { "x": 370, "y": 300 }
        },
        {
          "id": "update_n4",
          "name": "OrderController.updateOrder",
          "type": "controller",
          "layer": "backend",
          "position": { "x": 510, "y": 300 },
          "sourceFile": "backend/src/main/java/com/example/controller/OrderController.java",
          "sourceLine": 58,
          "metadata": {
            "signature": "@PostMapping(\"/api/order/update/{id}\")\npublic ResponseEntity<OrderVO> updateOrder(@PathVariable Long id, @RequestBody UpdateOrderRequest req)",
            "codeSnippet": "@PostMapping(\"/api/order/update/{id}\")\n@Validated\npublic ResponseEntity<OrderVO> updateOrder(@PathVariable Long id, @RequestBody @Valid UpdateOrderRequest req) {\n  OrderVO vo = orderService.updateOrder(id, req);\n  return ResponseEntity.ok(vo);\n}",
            "annotations": ["@PostMapping", "@Validated", "@Valid"]
          }
        },
        {
          "id": "update_n5",
          "name": "OrderValidator.validate",
          "type": "validator",
          "layer": "backend",
          "position": { "x": 650, "y": 220 },
          "sourceFile": "backend/src/main/java/com/example/validator/OrderValidator.java",
          "sourceLine": 15,
          "description": "参数校验，会产生分支",
          "metadata": {
            "signature": "public void validate(UpdateOrderRequest req) throws ValidationException",
            "codeSnippet": "public void validate(UpdateOrderRequest req) throws ValidationException {\n  if (req.getTotalPrice() <= 0) {\n    throw new ValidationException(\"订单金额必须大于 0\");\n  }\n  if (req.getItems() == null || req.getItems().isEmpty()) {\n    throw new ValidationException(\"订单至少包含一个商品\");\n  }\n}"
          }
        },
        {
          "id": "update_n6",
          "name": "OrderService.updateOrder",
          "type": "service",
          "layer": "backend",
          "position": { "x": 650, "y": 380 },
          "sourceFile": "backend/src/main/java/com/example/service/OrderService.java",
          "sourceLine": 88,
          "description": "订单更新业务逻辑（校验通过时执行）",
          "metadata": {
            "signature": "public OrderVO updateOrder(Long id, UpdateOrderRequest req)",
            "codeSnippet": "@Transactional\npublic OrderVO updateOrder(Long id, UpdateOrderRequest req) {\n  Order order = orderRepository.findById(id).orElseThrow();\n  order.setStatus(req.getStatus());\n  order.setTotalPrice(req.getTotalPrice());\n  orderRepository.save(order);\n  return order.toVO();\n}",
            "annotations": ["@Transactional"]
          }
        },
        {
          "id": "update_n7",
          "name": "OrderRepository.save",
          "type": "repository",
          "layer": "backend",
          "position": { "x": 790, "y": 380 },
          "metadata": {
            "signature": "Order save(Order entity)",
            "executesSQL": "UPDATE orders SET status = ?, total_price = ?, updated_at = ? WHERE id = ?"
          }
        },
        {
          "id": "update_n8",
          "name": "UPDATE orders",
          "type": "sql",
          "layer": "backend",
          "position": { "x": 1000, "y": 380 },
          "metadata": {
            "sql": "UPDATE orders SET status = ?, total_price = ?, updated_at = ? WHERE id = ?",
            "table": "orders"
          }
        },
        {
          "id": "update_n_err",
          "name": "ValidationException",
          "type": "exception",
          "layer": "backend",
          "position": { "x": 790, "y": 220 },
          "description": "参数校验失败时抛出异常",
          "metadata": {
            "exceptionType": "ValidationException",
            "httpStatus": 400,
            "message": "订单参数不合法"
          }
        }
      ],
      
      "edges": [
        {
          "id": "update_e1",
          "source": "update_n1",
          "target": "update_n2",
          "type": "function-call",
          "label": "api.updateOrder(id, data)"
        },
        {
          "id": "update_e2",
          "source": "update_n2",
          "target": "update_n3",
          "type": "http-request",
          "label": "HTTP POST"
        },
        {
          "id": "update_e3",
          "source": "update_n3",
          "target": "update_n4",
          "type": "http-request",
          "label": "HTTP 请求"
        },
        {
          "id": "update_e4",
          "source": "update_n4",
          "target": "update_n5",
          "type": "method-call",
          "label": "@Valid 触发校验"
        },
        {
          "id": "update_e_success",
          "source": "update_n5",
          "target": "update_n6",
          "type": "method-call",
          "label": "✓ 校验通过"
        },
        {
          "id": "update_e_fail",
          "source": "update_n5",
          "target": "update_n_err",
          "type": "method-call",
          "label": "✗ 校验失败"
        },
        {
          "id": "update_e6",
          "source": "update_n6",
          "target": "update_n7",
          "type": "method-call",
          "label": "orderRepository.save()"
        },
        {
          "id": "update_e7",
          "source": "update_n7",
          "target": "update_n8",
          "type": "db-query",
          "label": "SQL 执行"
        }
      ],
      
      "branches": [
        {
          "id": "update_branch_1",
          "nodeId": "update_n5",
          "condition": "UpdateOrderRequest 参数校验",
          "type": "validation",
          "paths": [
            {
              "name": "success",
              "description": "校验通过，继续更新",
              "condition": "req.totalPrice > 0 && req.items.size() > 0",
              "nextNode": "update_n6",
              "status": "success",
              "color": "#5F7D58"
            },
            {
              "name": "failure",
              "description": "校验失败，返回 400 错误",
              "exception": {
                "type": "ValidationException",
                "httpStatus": 400,
                "message": "订单参数不合法"
              },
              "nextNode": "update_n_err",
              "status": "error",
              "color": "#B54A35"
            }
          ]
        }
      ],
      
      "statistics": {
        "nodeCount": 9,
        "classCount": 5,
        "methodCount": 6,
        "hasBranch": true,
        "hasTransaction": true,
        "hasException": true,
        "depth": 8
      }
    },
    
    {
      "id": "order_create",
      "name": "创建订单",
      "businessFunction": "新增",
      "description": "用户填写订单信息并提交，系统创建订单、扣减库存，事务内完成",
      "method": "POST",
      "apiPath": "/api/order/create",
      "status": "success",
      "tags": ["事务"],
      
      "frontendAnchor": {
        "template": {
          "file": "frontend/src/views/OrderList.vue",
          "line": 120,
          "code": "<button @click=\"handleSubmitOrder\" :disabled=\"submitting\">提交订单</button>",
          "selector": "handleSubmitOrder"
        },
        "script": {
          "file": "frontend/src/views/OrderList.vue",
          "line": 160,
          "method": "handleSubmitOrder",
          "signature": "async handleSubmitOrder()",
          "body": { "start": 160, "end": 175 }
        },
        "apiWrapper": {
          "file": "frontend/src/api/order.js",
          "line": 8,
          "function": "createOrder",
          "signature": "export function createOrder(payload) { ... }",
          "body": { "start": 8, "end": 12 },
          "endpoint": "POST /api/order/create"
        }
      },
      
      "nodes": [
        {
          "id": "create_n1",
          "name": "OrderList.handleSubmitOrder",
          "type": "vue-event",
          "layer": "frontend",
          "position": { "x": 100, "y": 500 },
          "sourceFile": "frontend/src/views/OrderList.vue",
          "sourceLine": 160,
          "metadata": {
            "signature": "async handleSubmitOrder()",
            "codeSnippet": "async handleSubmitOrder() {\n  this.submitting = true;\n  try {\n    const res = await api.createOrder(this.orderForm);\n    this.orders.unshift(res.data);\n    this.$message.success('订单创建成功');\n    this.orderForm = {};\n  } finally {\n    this.submitting = false;\n  }\n}"
          }
        },
        {
          "id": "create_n2",
          "name": "createOrder",
          "type": "api-wrapper",
          "layer": "frontend",
          "position": { "x": 230, "y": 500 },
          "sourceFile": "frontend/src/api/order.js",
          "sourceLine": 8,
          "metadata": {
            "signature": "function createOrder(payload)",
            "codeSnippet": "export function createOrder(payload) {\n  return request.post('/api/order/create', payload);\n}",
            "endpoint": "POST /api/order/create"
          }
        },
        {
          "id": "create_n3",
          "name": "POST /api/order/create",
          "type": "http-request",
          "layer": "frontend-backend-boundary",
          "position": { "x": 370, "y": 500 }
        },
        {
          "id": "create_n4",
          "name": "OrderController.createOrder",
          "type": "controller",
          "layer": "backend",
          "position": { "x": 510, "y": 500 },
          "sourceFile": "backend/src/main/java/com/example/controller/OrderController.java",
          "sourceLine": 45,
          "metadata": {
            "signature": "@PostMapping(\"/api/order/create\")\npublic ResponseEntity<OrderVO> createOrder(@RequestBody @Valid CreateOrderRequest req)",
            "codeSnippet": "@PostMapping(\"/api/order/create\")\n@Validated\npublic ResponseEntity<OrderVO> createOrder(@RequestBody @Valid CreateOrderRequest req) {\n  OrderVO vo = orderService.saveOrder(req);\n  return ResponseEntity.status(HttpStatus.CREATED).body(vo);\n}",
            "annotations": ["@PostMapping", "@Validated", "@Valid"]
          }
        },
        {
          "id": "create_n5",
          "name": "OrderService.saveOrder",
          "type": "service",
          "layer": "backend",
          "position": { "x": 650, "y": 500 },
          "sourceFile": "backend/src/main/java/com/example/service/OrderService.java",
          "sourceLine": 65,
          "description": "@Transactional 事务边界",
          "metadata": {
            "signature": "@Transactional\npublic OrderVO saveOrder(CreateOrderRequest req)",
            "annotations": ["@Transactional"],
            "codeSnippet": "@Transactional\npublic OrderVO saveOrder(CreateOrderRequest req) {\n  // 1. 创建订单\n  Order order = new Order();\n  order.setUserId(getCurrentUserId());\n  order.setTotalPrice(req.getTotalPrice());\n  order.setStatus(\"pending_payment\");\n  orderRepository.save(order);\n  \n  // 2. 扣减库存\n  for (OrderItem item : req.getItems()) {\n    stockService.deductStock(item.getSkuId(), item.getQuantity());\n  }\n  \n  return order.toVO();\n}",
            "transactionStart": true
          }
        },
        {
          "id": "create_n6",
          "name": "OrderRepository.save",
          "type": "repository",
          "layer": "backend",
          "position": { "x": 790, "y": 440 },
          "metadata": {
            "signature": "Order save(Order entity)",
            "executesSQL": "INSERT INTO orders (id, user_id, total_price, status, created_at) VALUES (?, ?, ?, ?, ?)"
          }
        },
        {
          "id": "create_n7",
          "name": "StockService.deductStock",
          "type": "service",
          "layer": "backend",
          "position": { "x": 790, "y": 560 },
          "sourceFile": "backend/src/main/java/com/example/service/StockService.java",
          "sourceLine": 30,
          "description": "库存服务，在同一事务内执行",
          "metadata": {
            "signature": "public void deductStock(String skuId, Integer quantity)",
            "codeSnippet": "public void deductStock(String skuId, Integer quantity) {\n  Stock stock = stockRepository.findBySku(skuId).orElseThrow();\n  if (stock.getAvailableQty() < quantity) {\n    throw new InsufficientStockException(\"库存不足\");\n  }\n  stock.setAvailableQty(stock.getAvailableQty() - quantity);\n  stockRepository.save(stock);\n}"
          }
        },
        {
          "id": "create_n8",
          "name": "INSERT INTO orders",
          "type": "sql",
          "layer": "backend",
          "position": { "x": 1000, "y": 440 },
          "metadata": {
            "sql": "INSERT INTO orders (id, user_id, total_price, status, created_at) VALUES (?, ?, ?, ?, ?)",
            "table": "orders"
          }
        },
        {
          "id": "create_n9",
          "name": "UPDATE stock",
          "type": "sql",
          "layer": "backend",
          "position": { "x": 1000, "y": 560 },
          "metadata": {
            "sql": "UPDATE stock SET available_qty = available_qty - ? WHERE sku_id = ? AND available_qty >= ?",
            "table": "stock"
          }
        }
      ],
      
      "edges": [
        {
          "id": "create_e1",
          "source": "create_n1",
          "target": "create_n2",
          "type": "function-call",
          "label": "api.createOrder(orderForm)"
        },
        {
          "id": "create_e2",
          "source": "create_n2",
          "target": "create_n3",
          "type": "http-request",
          "label": "HTTP POST"
        },
        {
          "id": "create_e3",
          "source": "create_n3",
          "target": "create_n4",
          "type": "http-request",
          "label": "HTTP 请求"
        },
        {
          "id": "create_e4",
          "source": "create_n4",
          "target": "create_n5",
          "type": "service-call",
          "label": "orderService.saveOrder(req)"
        },
        {
          "id": "create_e5",
          "source": "create_n5",
          "target": "create_n6",
          "type": "method-call",
          "label": "orderRepository.save(order)"
        },
        {
          "id": "create_e6",
          "source": "create_n5",
          "target": "create_n7",
          "type": "service-call",
          "label": "stockService.deductStock()"
        },
        {
          "id": "create_e7",
          "source": "create_n6",
          "target": "create_n8",
          "type": "db-query",
          "label": "SQL 执行"
        },
        {
          "id": "create_e8",
          "source": "create_n7",
          "target": "create_n9",
          "type": "method-call",
          "label": "stockRepository.save()"
        },
        {
          "id": "create_e9",
          "source": "create_n7",
          "target": "create_n9",
          "type": "db-query",
          "label": "SQL 执行"
        }
      ],
      
      "branches": [],
      
      "transactions": [
        {
          "id": "create_txn_1",
          "name": "@Transactional",
          "startNode": "create_n5",
          "endNode": "create_n9",
          "operations": [
            {
              "type": "INSERT",
              "table": "orders",
              "sql": "INSERT INTO orders (id, user_id, total_price, status, created_at) VALUES (?, ?, ?, ?, ?)"
            },
            {
              "type": "UPDATE",
              "table": "stock",
              "sql": "UPDATE stock SET available_qty = available_qty - ? WHERE sku_id = ? AND available_qty >= ?"
            }
          ],
          "isolationLevel": "READ_COMMITTED",
          "propagation": "REQUIRED",
          "description": "在同一个事务内完成订单创建和库存扣减，保证原子性"
        }
      ],
      
      "statistics": {
        "nodeCount": 9,
        "classCount": 4,
        "methodCount": 7,
        "hasBranch": false,
        "hasTransaction": true,
        "hasException": false,
        "depth": 8
      }
    }
  ],
  
  "metadata": {
    "analyzedAt": "2026-11-21T10:30:00Z",
    "projectRoot": "D:\\Projects\\my-app",
    "claudeCodeVersion": "1.2.5",
    "analysisMethod": "static-analysis",
    "statistics": {
      "totalChains": 3,
      "totalNodes": 25,
      "totalClasses": 12,
      "totalMethods": 18,
      "branches": 1,
      "transactions": 1,
      "apis": 3,
      "sqlOperations": 7
    }
  }
}
```

---

## 字段映射表：前端 → 后端

用于 Claude Code 提示词中明确指导分析路径：

| 字段 | 说明 | 示例 |
|------|------|------|
| `frontendAnchor.template.selector` | Vue 事件处理函数名，在 `<template>` 中的 `@click` 或 `@submit` 属性 | `handleCreateOrder`, `handleEditOrder` |
| `frontendAnchor.script.method` | 同一文件中 `<script>` 段落的函数名 | `handleCreateOrder` |
| `frontendAnchor.script.body.start/end` | 函数体在文件中的行号 | 160-175 |
| `frontendAnchor.apiWrapper.file` | API 封装文件路径（通常在 `src/api/` 或 `src/services/`） | `frontend/src/api/order.js` |
| `frontendAnchor.apiWrapper.function` | API 封装函数名 | `createOrder` |
| `frontendAnchor.apiWrapper.endpoint` | HTTP 方法 + 路径 | `POST /api/order/create` |
| `nodes[].sourceFile` | 后端源码文件绝对或相对路径 | `backend/src/main/java/com/example/controller/OrderController.java` |
| `nodes[].sourceLine` | 节点对应的代码行号 | 45 |
| `nodes[].metadata.signature` | 方法签名或 SQL 语句 | `@PostMapping(...) public ResponseEntity<OrderVO> createOrder(...)` |
| `nodes[].type` | 节点类型 | `controller`, `service`, `repository`, `sql`, etc. |

---

## 前端渲染指南

### 1. DAG 链路图（ECharts）

使用 `nodes` 和 `edges` 数组直接渲染：

```javascript
const option = {
  series: [{
    type: 'graph',
    data: chain.nodes.map(n => ({
      name: n.name,
      x: n.position.x,
      y: n.position.y,
      symbolSize: calculateSize(n.type),
      itemStyle: { color: getColorByType(n.type) },
      label: { show: true, formatter: n.name }
    })),
    links: chain.edges.map(e => ({
      source: e.source,
      target: e.target,
      value: e.label
    }))
  }]
};
```

### 2. 链路卡片（纵向堆叠）

按 `nodes` 顺序和 `branches` 条件逻辑展示：

```html
<div class="chain-item">
  <div class="chain-header">
    <span class="method">{{ chain.method }}</span>
    <span class="path">{{ chain.apiPath }}</span>
    <span class="tag">{{ chain.businessFunction }}</span>
  </div>
  <div class="chain-flow">
    <div v-for="node in chain.nodes" class="flow-item">
      <div class="flow-step">{{ node.name }}</div>
      <div v-if="node.metadata.signature" class="signature">{{ node.metadata.signature }}</div>
    </div>
    <!-- 条件分支渲染 -->
    <div v-for="branch in chain.branches" class="branch-section">
      <div v-for="path in branch.paths" :class="{ success: path.status === 'success', error: path.status === 'error' }">
        {{ path.condition }} → {{ path.nextNode }}
      </div>
    </div>
  </div>
</div>
```

### 3. 跳转到源码

点击任何节点都可跳转到源码：

```javascript
function goToSource(node) {
  const file = node.sourceFile;
  const line = node.sourceLine;
  // IDE 协议：vscode://file/<path>:<line>:<column>
  window.open(`vscode://file/${projectRoot}/${file}:${line}`);
}
```

---

## 约定

1. **节点 ID 命名**: `{chainId}_n{number}` （如 `create_order_n1`, `profile_get_n3`）
2. **边 ID 命名**: `{chainId}_e{number}` （如 `create_order_e1`）
3. **分支 ID 命名**: `{chainId}_branch_{number}` （如 `order_update_branch_1`）
4. **行号从 1 开始**，对应源码编辑器显示
5. **所有路径相对于 `projectRoot`**，便于 IDE 集成
6. **sourceFile 优先使用相对路径**（相对于项目根目录）

---

## 扩展性

该模型支持：

- ✓ 1~10+ 个业务功能 → 直接扩展 `chains` 数组
- ✓ 异步调用链 → 用 `type: "async-call"` 边标记
- ✓ 消息队列 → 用 `type: "message-queue"` 节点和边
- ✓ 缓存层 → 用 `type: "cache"` 节点
- ✓ 多个分支融合 → `edges[].type` 支持 `merge`
- ✓ 循环调用 → 在节点 `metadata` 中标记 `recursive: true`
- ✓ 条件事务 → 在 `branches[].paths` 中各自定义事务边界

