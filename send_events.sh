file="$1"
if [ -z "$file" ]
then
   file="event.json"
fi


#shift

for file in $*
do
   echo $file

   curl -v -m 180 --location  'https://events.stage.syncrofy.com/events/upload/97b47e4d-578a-41cd-a396-ce8fc94c869f/c0198971-0858-4f10-b224-29467c6ca5f0' \
      --header 'token: 1a0ec115-d165-49a5-88ad-57a86f77b0c9' \
      --header 'Content-Type: application/json' \
      --data-binary "@$file"

   grep "coreId" $file | sort -u

done
 