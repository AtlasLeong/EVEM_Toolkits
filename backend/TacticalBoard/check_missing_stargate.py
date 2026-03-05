import requests
import pymysql
import sys

# 数据库连接配置
db_config = {
    'host': 'localhost',
    'user': 'root',  # 替换为你的用户名
    'password': '123456',  # 替换为你的密码
    'db': 'eve_fetch_data',  # 数据库名
    'autocommit': True  # 确保所有更改都会立即提交到数据库
}

# EVE API的URL
EVE_API_URL = 'https://esi.evetech.net/latest/'


# 从API获取数据
def fetch_from_api(endpoint):
    response = requests.get(EVE_API_URL + endpoint)
    if response.status_code == 200:
        return response.json()
    else:
        response.raise_for_status()


# 数据存储逻辑
def store_data(cursor, table_name, columns, data):
    placeholders = ', '.join(['%s'] * len(columns))
    sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders}) ON DUPLICATE KEY UPDATE"
    update_statement = ', '.join([f"{col}=VALUES({col})" for col in columns])
    sql = f"{sql} {update_statement}"
    try:
        cursor.execute(sql, data)
        print(f"Data stored in {table_name} for {data[0]}")
    except Exception as e:
        print(f"Error inserting into {table_name} for {data[0]}: {e}")


# 检查并补全缺失的星门数据
def check_and_fix_stargates():
    with pymysql.connect(**db_config) as connection:
        with connection.cursor(pymysql.cursors.DictCursor) as cursor:
            # 获取所有星系ID
            cursor.execute("SELECT system_id FROM star_systems")
            systems = cursor.fetchall()

            # 获取已检查的星系ID
            cursor.execute("SELECT system_id FROM checked_systems")
            checked_systems = {row['system_id'] for row in cursor.fetchall()}

            for system in systems:
                system_id = system['system_id']
                if system_id in checked_systems:
                    continue  # 跳过已检查的星系

                system_data = fetch_from_api(f'universe/systems/{system_id}/')

                for stargate_id in system_data.get('stargates', []):
                    # 检查数据库中是否存在该星门
                    cursor.execute("SELECT stargate_id FROM stargates WHERE stargate_id = %s", (stargate_id,))
                    if cursor.fetchone() is None:
                        # 星门不存在，获取并存储星门数据
                        stargate_data = fetch_from_api(f'universe/stargates/{stargate_id}/')
                        store_data(cursor, 'stargates',
                                   ['stargate_id', 'system_id', 'name', 'type_id', 'destination_system_id',
                                    'destination_stargate_id', 'x', 'y', 'z'],
                                   [
                                       stargate_id,
                                       system_id,
                                       stargate_data['name'],
                                       stargate_data['type_id'],
                                       stargate_data['destination']['system_id'],
                                       stargate_data['destination']['stargate_id'],
                                       stargate_data['position']['x'],
                                       stargate_data['position']['y'],
                                       stargate_data['position']['z']
                                   ])
                        print(f"Stored missing stargate: {stargate_data['name']}")

                # 记录已检查的星系
                cursor.execute("INSERT INTO checked_systems (system_id) VALUES (%s) ON DUPLICATE KEY UPDATE system_id=system_id", (system_id,))
                print(f"Checked and recorded system: {system_id}")


# 主函数
def main():
    try:
        check_and_fix_stargates()
    except requests.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
    except pymysql.MySQLError as db_err:
        print(f"Database error occurred: {db_err}")
    except Exception as err:
        print(f"An error occurred: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
