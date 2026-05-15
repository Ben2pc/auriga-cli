# 各语言简化示例

主文档讲的是判断准则和流程,这份参考是**具体的简化前后对照**——TypeScript / JavaScript、Python、React。

这些是模式示例,不是规则:**先跟随项目约定**(主文档铁律三)。同样的简化,在一个代码库里是改进,在另一个里可能违反既有风格——以代码库里邻近的写法为准。

## TypeScript / JavaScript

```typescript
// 简化:多余的 async 包装
// 前
async function getUser(id: string): Promise<User> {
  return await userService.findById(id);
}
// 后
function getUser(id: string): Promise<User> {
  return userService.findById(id);
}

// 简化:啰嗦的条件赋值
// 前
let displayName: string;
if (user.nickname) {
  displayName = user.nickname;
} else {
  displayName = user.fullName;
}
// 后
const displayName = user.nickname || user.fullName;

// 简化:手工构建数组(以管道取代循环)
// 前
const activeUsers: User[] = [];
for (const user of users) {
  if (user.isActive) {
    activeUsers.push(user);
  }
}
// 后
const activeUsers = users.filter((user) => user.isActive);

// 简化:多余的布尔返回
// 前
function isValid(input: string): boolean {
  if (input.length > 0 && input.length < 100) {
    return true;
  }
  return false;
}
// 后
function isValid(input: string): boolean {
  return input.length > 0 && input.length < 100;
}

// 简化:密集的三元链 —— 清晰胜于聪明(主文档铁律六)
// 前
const label = isNew ? 'New' : isUpdated ? 'Updated' : isArchived ? 'Archived' : 'Active';
// 后
function getStatusLabel(item: Item): string {
  if (item.isNew) return 'New';
  if (item.isUpdated) return 'Updated';
  if (item.isArchived) return 'Archived';
  return 'Active';
}
```

## Python

```python
# 简化:啰嗦的字典构建
# 前
result = {}
for item in items:
    result[item.id] = item.name
# 后
result = {item.id: item.name for item in items}

# 简化:嵌套条件改早返回(以守卫语句取代嵌套条件)
# 前
def process(data):
    if data is not None:
        if data.is_valid():
            if data.has_permission():
                return do_work(data)
            else:
                raise PermissionError("No permission")
        else:
            raise ValueError("Invalid data")
    else:
        raise TypeError("Data is None")
# 后
def process(data):
    if data is None:
        raise TypeError("Data is None")
    if not data.is_valid():
        raise ValueError("Invalid data")
    if not data.has_permission():
        raise PermissionError("No permission")
    return do_work(data)
```

## React / JSX

```tsx
// 简化:啰嗦的条件渲染
// 前
function UserBadge({ user }: Props) {
  if (user.isAdmin) {
    return <Badge variant="admin">Admin</Badge>;
  } else {
    return <Badge variant="default">User</Badge>;
  }
}
// 后
function UserBadge({ user }: Props) {
  const variant = user.isAdmin ? 'admin' : 'default';
  const label = user.isAdmin ? 'Admin' : 'User';
  return <Badge variant={variant}>{label}</Badge>;
}
```

```tsx
// 判断,不要自动改:逐层透传 prop
// 一个 prop 穿过好几层中间组件,本身只是它们的"过路客"。
// 用 context 或组合(composition)可能更好 —— 但这是个判断题,
// 涉及组件边界,接近 arch-design 的高度。标记出来交给用户,
// 不要自动重构。
```
